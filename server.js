'use strict';
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const ff = require('./lib/ffmpeg');
const r2 = require('./lib/r2');

const PORT = parseInt(process.env.PORT || '3000', 10);
const TOKEN = (process.env.TOKEN || '').trim();
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const WORK_DIR = path.join(ROOT, 'work');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

let HAS_NVENC = false;
ff.checkNvenc().then((v) => {
  HAS_NVENC = v;
  console.log('[启动] NVENC 硬件编码: ' + (v ? '可用 (GPU)' : '不可用，将使用 CPU 编码'));
});

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

// ---- 任务存储 ----
const tasks = new Map(); // id -> task

function sanitizeName(name) {
  const base = path.basename(name).replace(/\.[^.]+$/, '');
  const s = base.replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'video';
}

function snapshot(t) {
  return {
    id: t.id,
    name: t.name,
    safeName: t.safeName,
    size: t.size,
    status: t.status,
    mode: t.mode,
    resScheme: t.resScheme,
    transcodePercent: Math.round(t.transcodePercent || 0),
    uploadPercent: Math.round(t.uploadPercent || 0),
    duration: t.duration,
    width: t.width,
    height: t.height,
    codec: t.codec,
    renditions: (t.renditions || []).map((r) => r.label),
    outputSize: t.outputSize || 0,
    error: t.error || '',
    r2: t.r2 || null,
    createdAt: t.createdAt,
  };
}

function emit(t) {
  t.emitter.emit('update', snapshot(t));
}

// ---- 可选鉴权 ----
function auth(req, res, next) {
  if (!TOKEN) return next();
  const t = req.headers['x-token'] || req.query.token;
  if (t === TOKEN) return next();
  res.status(401).json({ error: '需要访问密码' });
}

app.get('/api/config', (req, res) => {
  res.json({ requireAuth: !!TOKEN, nvenc: HAS_NVENC });
});

// ---- 上传 + 探测 ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, id + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50GB
});

app.post('/api/upload', auth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const id = path.basename(req.file.filename).replace(/\.[^.]+$/, '');
    const info = await ff.probe(req.file.path);
    if (!info.duration || !info.height) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: '无法识别该视频文件（可能不是有效的视频）' });
    }
    const task = {
      id,
      name: req.file.originalname,
      safeName: sanitizeName(req.file.originalname),
      inputPath: req.file.path,
      size: req.file.size,
      status: 'ready',
      duration: info.duration,
      width: info.width,
      height: info.height,
      codec: info.codec,
      transcodePercent: 0,
      uploadPercent: 0,
      createdAt: Date.now(),
      emitter: new EventEmitter(),
      _proc: null,
    };
    tasks.set(id, task);
    res.json({
      id,
      name: task.name,
      size: task.size,
      duration: info.duration,
      width: info.width,
      height: info.height,
      codec: info.codec,
      nvenc: HAS_NVENC,
    });
  } catch (e) {
    res.status(500).json({ error: '上传处理失败: ' + e.message });
  }
});

// ---- 开始转码 ----
app.post('/api/tasks/:id/transcode', auth, async (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  if (!['ready', 'failed', 'done', 'r2_done'].includes(t.status)) {
    return res.status(400).json({ error: '当前状态不可重新转码: ' + t.status });
  }
  const mode = req.body.mode || 'hevc_balanced';
  const encoder = req.body.encoder || 'auto';

  // 解析编码器
  let useNvenc;
  if (encoder === 'gpu') {
    if (!HAS_NVENC) return res.status(400).json({ error: '未检测到可用的 GPU 硬件编码（NVENC），请改用“自动”或“CPU”' });
    useNvenc = true;
  } else if (encoder === 'cpu') {
    useNvenc = false;
  } else {
    useNvenc = HAS_NVENC; // auto
  }

  // 解析清晰度档位（向下兼容校验）
  let renditions;
  if (mode === 'copy') {
    renditions = [{ label: ff.labelFor(t.height), height: t.height, dir: t.height + 'p' }];
  } else {
    let heights = Array.isArray(req.body.renditions) ? req.body.renditions.map((h) => parseInt(h, 10)).filter((h) => h > 0) : [];
    const cap = mode === 'h264_compat' ? 2160 : 4320;
    heights = heights.filter((h) => h <= t.height && h <= cap);
    heights = [...new Set(heights)].sort((a, b) => b - a);
    if (heights.length === 0) heights = [Math.min(t.height, cap)];
    renditions = heights.map((h) => ({ label: ff.labelFor(h), height: h, dir: h + 'p' }));
  }

  t.mode = mode;
  t.encoder = encoder;
  t.resScheme = renditions.length > 1 ? 'adaptive' : 'single';
  t.renditions = renditions;
  t.status = 'transcoding';
  t.transcodePercent = 0;
  t.uploadPercent = 0;
  t.error = '';
  t.r2 = null;
  emit(t);
  res.json({ ok: true, renditions: renditions.map((r) => r.label), encoder: useNvenc ? 'GPU(NVENC)' : 'CPU' });

  // 异步执行转码
  (async () => {
    const workDir = path.join(WORK_DIR, t.id);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    try {
      const n = renditions.length;
      for (let i = 0; i < n; i++) {
        const r = renditions[i];
        await ff.transcodeRendition({
          input: t.inputPath,
          outDir: path.join(workDir, r.dir),
          height: r.height,
          sourceHeight: t.height,
          mode,
          useNvenc,
          duration: t.duration,
          onProc: (proc) => { t._proc = proc; },
          onProgress: (pct) => {
            t.transcodePercent = ((i + pct / 100) / n) * 100;
            emit(t);
          },
        });
      }
      ff.writeMaster(renditions, workDir);
      t.outputSize = ff.dirSize(workDir);
      t.transcodePercent = 100;
      t.status = 'done';
      t._proc = null;
      emit(t);
    } catch (e) {
      t.status = 'failed';
      t.error = e.message;
      t._proc = null;
      emit(t);
    }
  })();
});

// ---- 取消转码 ----
app.post('/api/tasks/:id/cancel', auth, (req, res) => {
  const t = tasks.get(req.params.id);
  if (t && t._proc) { try { t._proc.kill('SIGKILL'); } catch (e) {} }
  res.json({ ok: true });
});

// ---- SSE 进度 ----
app.get('/api/tasks/:id/events', auth, (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const handler = (snap) => res.write('data: ' + JSON.stringify(snap) + '\n\n');
  t.emitter.on('update', handler);
  res.write('data: ' + JSON.stringify(snapshot(t)) + '\n\n');
  const keep = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(keep); t.emitter.off('update', handler); });
});

// ---- 任务列表 ----
app.get('/api/tasks', auth, (req, res) => {
  const list = [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt).map(snapshot);
  res.json(list);
});

// ---- 下载 ZIP ----
app.get('/api/tasks/:id/download', auth, (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t || t.status !== 'done') return res.status(400).json({ error: '任务未完成' });
  const workDir = path.join(WORK_DIR, t.id);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(t.safeName) + '_HLS.zip"');
  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', (e) => { try { res.end(); } catch (_) {} });
  archive.pipe(res);
  archive.directory(workDir, false);
  archive.finalize();
});

// ---- 测试 R2 连接 ----
app.post('/api/r2/test', auth, async (req, res) => {
  const { endpoint, accessKeyId, secretAccessKey, bucket } = req.body || {};
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return res.status(400).json({ error: '请填写完整的 R2 连接信息' });
  }
  try {
    await r2.testConnection({ endpoint, accessKeyId, secretAccessKey, bucket });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: '连接失败: ' + e.message });
  }
});

// ---- 上传到 R2 ----
app.post('/api/tasks/:id/upload-r2', auth, async (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  if (t.status !== 'done') return res.status(400).json({ error: '请先完成转码' });
  const { endpoint, accessKeyId, secretAccessKey, bucket } = req.body || {};
  const prefix = (req.body.prefix || 'hls').replace(/^\/+/, '');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return res.status(400).json({ error: '请填写完整的 R2 连接信息' });
  }
  t.status = 'uploading_r2';
  t.uploadPercent = 0;
  t.error = '';
  emit(t);
  res.json({ ok: true });

  (async () => {
    try {
      const keyPrefix = prefix + '/' + t.safeName;
      const result = await r2.uploadDir(
        { endpoint, accessKeyId, secretAccessKey, bucket },
        path.join(WORK_DIR, t.id),
        keyPrefix,
        (pct) => { t.uploadPercent = pct; emit(t); }
      );
      t.uploadPercent = 100;
      t.status = 'r2_done';
      t.r2 = {
        bucket,
        prefix: keyPrefix,
        primary: keyPrefix + '/master.m3u8',
        count: result.count,
        totalBytes: result.totalBytes,
      };
      emit(t);
    } catch (e) {
      t.status = 'failed';
      t.error = 'R2 上传失败: ' + e.message;
      emit(t);
    }
  })();
});

// ---- 清理任务（删除临时文件）----
app.delete('/api/tasks/:id', auth, (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  if (t._proc) { try { t._proc.kill('SIGKILL'); } catch (e) {} }
  fs.rm(path.join(WORK_DIR, t.id), { recursive: true, force: true }, () => {});
  if (t.inputPath) fs.rm(t.inputPath, { force: true }, () => {});
  tasks.delete(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('[启动] 涛涛转码箱运行中: http://0.0.0.0:' + PORT);
  console.log('[启动] 临时目录: ' + os.tmpdir());
});
