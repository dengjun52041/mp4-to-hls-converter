#!/usr/bin/env bash
# 停止服务
cd "$(dirname "$0")"
if command -v systemctl >/dev/null 2>&1 && systemctl list-units --full -all 2>/dev/null | grep -q hls-transcoder.service; then
  systemctl stop hls-transcoder
  echo "已通过 systemd 停止"
else
  pkill -f "node .*server.js" && echo "已停止" || echo "未发现运行中的服务"
fi
