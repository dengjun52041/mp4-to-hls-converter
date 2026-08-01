#!/usr/bin/env bash
# ============================================================
# 涛涛转码箱 - 一键部署脚本（适用于 AutoDL / 各类 Ubuntu GPU 实例）
# 用法：把整个项目文件夹上传到实例后，在项目目录里执行  bash deploy.sh
# 全程无需输入，自动安装 ffmpeg(含NVENC) + Node + 依赖，并设置开机自启
# ============================================================
set -e
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
echo "==> 项目目录: $PROJECT_DIR"

# ---------- 1. 检测 GPU ----------
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  echo "==> 检测到 NVIDIA GPU，将启用 NVENC 硬件加速"
  nvidia-smi --query-gpu=name --format=csv,noheader | head -1 | sed 's/^/    GPU: /'
else
  echo "==> 未检测到 GPU，将使用 CPU 编码（速度较慢）"
fi

# ---------- 2. 安装 ffmpeg（带 NVENC 的静态构建）----------
install_ffmpeg_static() {
  local URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
  local MIRROR="https://ghfast.top/$URL"
  local TMP="/tmp/ffmpeg-static.tar.xz"
  echo "==> 下载 ffmpeg 静态构建（含 NVENC）…"
  if ! curl -fL --connect-timeout 15 -o "$TMP" "$URL" 2>/dev/null; then
    echo "    直连 GitHub 失败，改用镜像…"
    curl -fL --connect-timeout 20 -o "$TMP" "$MIRROR"
  fi
  echo "==> 解压并安装到 /usr/local/bin …"
  mkdir -p /tmp/ffmpeg-extract
  tar -xJf "$TMP" -C /tmp/ffmpeg-extract --strip-components=1
  cp -f /tmp/ffmpeg-extract/bin/ffmpeg /usr/local/bin/ffmpeg
  cp -f /tmp/ffmpeg-extract/bin/ffprobe /usr/local/bin/ffprobe
  chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe
  rm -rf "$TMP" /tmp/ffmpeg-extract
}

if command -v ffmpeg >/dev/null 2>&1 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q hevc_nvenc; then
  echo "==> 已存在支持 NVENC 的 ffmpeg，跳过安装"
else
  install_ffmpeg_static || {
    echo "==> 静态构建安装失败，尝试 apt 安装（可能不含 NVENC）…"
    apt-get update -y && apt-get install -y ffmpeg
  }
fi
echo "==> ffmpeg 版本:"; ffmpeg -version 2>/dev/null | head -1
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q hevc_nvenc; then
  echo "==> NVENC 硬件编码: 可用"
else
  echo "==> NVENC 不可用，运行时将自动回退到 CPU 编码"
fi

# ---------- 3. 安装 Node.js (>=18) ----------
need_node=1
if command -v node >/dev/null 2>&1; then
  NV=$(node -v | sed 's/v//;s/\..*//')
  [ "$NV" -ge 18 ] && need_node=0 && echo "==> 已存在 Node $(node -v)，跳过安装"
fi
if [ "$need_node" -eq 1 ]; then
  echo "==> 从 npmmirror 下载 Node.js v20 …"
  VER=$(curl -fsSL https://npmmirror.com/mirrors/node/latest-v20.x/ | grep -oE 'v20\.[0-9]+\.[0-9]+' | head -1)
  [ -z "$VER" ] && VER="v20.18.1"
  curl -fL -o /tmp/node.tar.xz "https://npmmirror.com/mirrors/node/latest-v20.x/node-${VER}-linux-x64.tar.xz"
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
  echo "==> Node 安装完成: $(node -v)"
fi
NODE_BIN="$(command -v node)"

# ---------- 4. 安装依赖 ----------
echo "==> 安装 npm 依赖（使用 npmmirror 加速）…"
npm install --registry=https://registry.npmmirror.com --no-audit --no-fund

# ---------- 5. 配置文件 ----------
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> 已生成 .env（R2 密钥请在网页界面填写，无需改这里）"
fi

# ---------- 6. 开机自启 ----------
mkdir -p work uploads
if command -v systemctl >/dev/null 2>&1 && [ "$(ps -p 1 -o comm=)" = "systemd" ]; then
  cat > /etc/systemd/system/hls-transcoder.service <<EOF
[Unit]
Description=HLS Web Transcoder
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_BIN $PROJECT_DIR/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable hls-transcoder >/dev/null 2>&1
  systemctl restart hls-transcoder
  echo "==> 已注册 systemd 服务并启动（开机自启）"
else
  echo "==> 未检测到 systemd，跳过服务注册。"
  echo "    每次开机后请手动执行:  bash $PROJECT_DIR/start.sh"
  bash "$PROJECT_DIR/start.sh"
fi

echo ""
echo "============================================================"
echo " 部署完成！"
echo " 网页端口: 3000"
echo " 请在云平台控制台把 3000 端口映射/放行后，用浏览器访问。"
echo " 查看运行状态:  systemctl status hls-transcoder  或  cat server.log"
echo "============================================================"
