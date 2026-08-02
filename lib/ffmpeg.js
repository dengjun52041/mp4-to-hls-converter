'use strict';
// ffmpeg 转码模块：探测、清晰度档位计算、NVENC/CPU 转码、进度解析、master.m3u8 生成
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// 清晰度阶梯（高度），从高到低
const LADDER = [
  { label: '8K', height: 4320 },
  { label: '4K', height: 2160 },
  { label: '2K', height: 1440 },
  { label: '1080p', height: 1080 },
  { label: '720p', height: 720 },
  { label: '480p', height: 480 },
  { label: '360p', height: 360 },
];

let nvencCache = null;
// 检测 NVENC 是否真正可用：实际跑一段微型编码（仅列出编码器不够，驱动过旧时会初始化失败）
function checkNvenc() {
  return new Promise((resolve) => {
    if (nvencCache !== null) return resolve(nvencCache);
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=10:duration=0.2',
      '-c:v', 'hevc_nvenc', '-f', 'null', '-',
    ];
    execFile(FFMPEG, args, { timeout: 25000 }, (err) => {
      nvencCache = !err;
      resolve(nvencCache);
    });
  });
}

// 探测视频时长 / 分辨率 / 编码
function probe(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name:format=duration',
      '-of', 'json',
      filePath,
    ];
    execFile(FFPROBE, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const j = JSON.parse(stdout);
        const s = (j.streams && j.streams[0]) || {};
        resolve({
          width: s.width || 0,
          height: s.height || 0,
          codec: s.codec_name || '',
          duration: parseFloat((j.format && j.format.duration) || '0') || 0,
        });
      } catch (e) { reject(e); }
    });
  });
}

// 单档可选清晰度（仅向下兼容；H.264 模式最高 4K）
function availableSingle(sourceHeight, mode) {
  let list = LADDER.filter((l) => l.height <= sourceHeight);
  if (mode === 'h264_compat') list = list.filter((l) => l.height <= 2160);
  const exact = list.some((l) => l.height === sourceHeight);
  if (!exact && sourceHeight > 480) {
    const cap = mode === 'h264_compat' ? 2160 : 4320;
    if (sourceHeight <= cap) list.unshift({ label: '原画 ' + sourceHeight + 'p', height: sourceHeight });
  }
  if (list.length === 0) list = [{ label: sourceHeight + 'p', height: sourceHeight }];
  return list;
}

// 自适应多档：从最高档向下到 480p，最多 4 档
function adaptiveRenditions(sourceHeight, mode) {
  let tops = LADDER.filter((l) => l.height <= sourceHeight);
  if (mode === 'h264_compat') tops = tops.filter((l) => l.height <= 2160);
  if (tops.length === 0) tops = [{ label: sourceHeight + 'p', height: sourceHeight }];
  const chosen = [];
  for (const l of tops) {
    chosen.push(l);
    if (chosen.length >= 4) break;
    if (l.height <= 480) break;
  }
  return chosen;
}

// 估算码率（用于 master.m3u8 的 BANDWIDTH 标签）
function estimateBw(height) {
  if (height >= 4320) return 30000000;
  if (height >= 2160) return 12000000;
  if (height >= 1440) return 7000000;
  if (height >= 1080) return 5000000;
  if (height >= 720) return 2500000;
  if (height >= 480) return 1000000;
  return 700000;
}

// 根据模式构造视频编码参数
function buildVideoArgs(mode, height, sourceHeight, useNvenc) {
  if (mode === 'copy') return { args: ['-c', 'copy'], vf: null };
  const vf = [];
  if (height < sourceHeight) vf.push('scale=-2:' + height);
  vf.push('format=yuv420p');
  let vargs;
  if (mode === 'hevc_balanced' || mode === 'hevc_small') {
    const cq = mode === 'hevc_small' ? 30 : 26;
    vargs = useNvenc
      ? ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-cq', String(cq), '-tag:v', 'hvc1']
      : ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(cq), '-x265-params', 'log-level=error', '-tag:v', 'hvc1'];
  } else {
    // h264_compat
    vargs = useNvenc
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23'];
  }
  return { args: vargs, vf: vf.join(',') };
}

// 转码单个清晰度档位，输出 HLS 到 outDir
function transcodeRendition(opts) {
  const { input, outDir, height, sourceHeight, mode, useNvenc, duration, onProgress, onProc } = opts;
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    const { args: vargs, vf } = buildVideoArgs(mode, height, sourceHeight, useNvenc);
    const args = ['-y', '-i', input];
    if (vf) args.push('-vf', vf);
    args.push(...vargs);
    if (mode !== 'copy') args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
    args.push(
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(outDir, 'seg_%05d.ts'),
      '-progress', 'pipe:1',
      '-nostats',
      path.join(outDir, 'index.m3u8')
    );

    const proc = spawn(FFMPEG, args);
    if (onProc) onProc(proc);
    let stderrTail = '';
    let lastUs = 0;
    proc.stdout.on('data', (d) => {
      const lines = d.toString().split('\n');
      for (const line of lines) {
        const m = line.match(/out_time_us=(\d+)/);
        if (m) lastUs = parseInt(m[1], 10);
      }
      if (duration > 0 && onProgress) {
        onProgress(Math.min(99, ((lastUs / 1e6) / duration) * 100));
      }
    });
    proc.stderr.on('data', (d) => {
      stderrTail += d.toString();
      if (stderrTail.length > 5000) stderrTail = stderrTail.slice(-5000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg 退出码 ' + code + '\n' + stderrTail.slice(-1500)));
    });
  });
}

// 生成 master.m3u8（自适应多档播放列表）
function writeMaster(renditions, workDir) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const r of renditions) {
    const w = Math.round((r.height * 16) / 9 / 2) * 2;
    lines.push('#EXT-X-STREAM-INF:BANDWIDTH=' + estimateBw(r.height) + ',RESOLUTION=' + w + 'x' + r.height);
    lines.push(r.dir + '/index.m3u8');
  }
  fs.writeFileSync(path.join(workDir, 'master.m3u8'), lines.join('\n') + '\n');
}

// 统计目录总大小
function dirSize(dir) {
  let total = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  })(dir);
  return total;
}

// 根据高度取显示标签（如 1080→1080p、1440→2K），找不到就用 高度+p
function labelFor(height) {
  const hit = LADDER.find((l) => l.height === height);
  return hit ? hit.label : height + 'p';
}

module.exports = {
  LADDER,
  checkNvenc,
  probe,
  availableSingle,
  adaptiveRenditions,
  transcodeRendition,
  writeMaster,
  dirSize,
  labelFor,
};
