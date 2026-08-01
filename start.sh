#!/usr/bin/env bash
# 手动启动（无 systemd 的环境用这个）
cd "$(dirname "$0")"
if pgrep -f "node .*server.js" >/dev/null 2>&1; then
  echo "服务已在运行中"
  exit 0
fi
nohup node server.js > server.log 2>&1 &
echo "已启动，PID: $!  日志: server.log  端口: 3000"
