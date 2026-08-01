# ============================================================
# 涛涛转码箱 - Docker 镜像（用于 AutoDL 社区镜像 / 任意 GPU 容器环境）
# 视频转 HLS 工具，GPU(NVENC) 硬件加速，无显卡自动回退 CPU
# ============================================================
FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PORT=3000

LABEL maintainer="涛涛碎碎念RE" \
      description="涛涛转码箱 - MP4/MKV 转 HLS 自适应流工具 (GPU NVENC 加速)"

# ---------- 基础工具 ----------
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl xz-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---------- Node.js 20 LTS（npmmirror，国内可达）----------
RUN curl -fsSL https://npmmirror.com/mirrors/node/v20.20.2/node-v20.20.2-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm -f /tmp/node.tar.xz \
    && node -v && npm -v

# ---------- ffmpeg 静态构建（含 NVENC）----------
# ghfast 镜像优先 → GitHub 直连兜底 → 都失败则 apt（无 NVENC，自动回退 CPU）
RUN curl -fsSL --connect-timeout 20 -o /tmp/ffmpeg.tar.xz \
        "https://ghfast.top/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz" \
    || curl -fsSL --connect-timeout 20 -o /tmp/ffmpeg.tar.xz \
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz" \
    || echo "static build download failed, fallback to apt"; \
    if [ -s /tmp/ffmpeg.tar.xz ]; then \
        mkdir -p /tmp/ff \
        && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ff --strip-components=1 \
        && cp /tmp/ff/bin/ffmpeg /tmp/ff/bin/ffprobe /usr/local/bin/ \
        && rm -rf /tmp/ff /tmp/ffmpeg.tar.xz; \
    else \
        apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*; \
    fi; \
    ffmpeg -version | head -1

# ---------- 应用代码 ----------
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --registry=https://registry.npmmirror.com --no-audit --no-fund --omit=dev
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY start.sh stop.sh ./
RUN mkdir -p /app/work /app/uploads && chmod +x /app/start.sh /app/stop.sh

EXPOSE 3000

# 默认启动服务。AutoDL 实例一般通过 SSH/JupyterLab 使用，
# 也可手动执行： bash /app/start.sh ，然后访问 http://localhost:3000
CMD ["node", "server.js"]
