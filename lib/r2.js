'use strict';
// Cloudflare R2 上传模块（S3 兼容）：测试连接、并发上传整个目录、进度统计
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const path = require('path');

function makeClient(creds) {
  return new S3Client({
    region: 'auto',
    endpoint: creds.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

// 测试连接：能列出桶内容即视为成功
async function testConnection(creds) {
  const client = makeClient(creds);
  await client.send(new ListObjectsV2Command({ Bucket: creds.bucket, MaxKeys: 1 }));
  return true;
}

const MIME = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 上传单个文件，带重试
async function uploadOne(client, bucket, key, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: fs.createReadStream(filePath),
          ContentType: MIME[ext] || 'application/octet-stream',
        },
        queueSize: 4,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      });
      await upload.done();
      return;
    } catch (e) {
      lastErr = e;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

// 上传整个目录到 R2，keyPrefix 为桶内目标前缀
async function uploadDir(creds, localDir, keyPrefix, onProgress) {
  const client = makeClient(creds);
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files.push(full);
    }
  })(localDir);

  const totalBytes = files.reduce((s, f) => s + fs.statSync(f).size, 0);
  let doneBytes = 0;
  const CONC = Math.min(8, files.length || 1);
  let idx = 0;
  const prefix = keyPrefix.replace(/\/+$/, '');

  async function worker() {
    while (idx < files.length) {
      const i = idx++;
      const full = files[i];
      const rel = path.relative(localDir, full).split(path.sep).join('/');
      const key = prefix + '/' + rel;
      await uploadOne(client, creds.bucket, key, full);
      doneBytes += fs.statSync(full).size;
      if (onProgress) onProgress(totalBytes ? (doneBytes / totalBytes) * 100 : 100, doneBytes, totalBytes);
    }
  }

  await Promise.all(Array.from({ length: CONC }, worker));
  return { count: files.length, totalBytes };
}

module.exports = { testConnection, uploadDir };
