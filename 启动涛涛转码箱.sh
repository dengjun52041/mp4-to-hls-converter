#!/bin/bash
# ============================================================
# 涛涛转码箱 · 一键启动脚本
# 用法：bash /root/启动涛涛转码箱.sh
# ============================================================
cd /root/taotao-transcoder || { echo "找不到 /root/taotao-transcoder 目录"; exit 1; }

if pgrep -f "node .*server.js" >/dev/null 2>&1; then
  echo "✓ 涛涛转码箱已在运行中，无需重复启动。"
else
  nohup node server.js > server.log 2>&1 &
  sleep 2
  if pgrep -f "node .*server.js" >/dev/null 2>&1; then
    echo "✓ 涛涛转码箱已启动！"
  else
    echo "✗ 启动失败，请查看日志：cat /root/taotao-transcoder/server.log"
    exit 1
  fi
fi

echo ""
echo "============================================================"
echo " 打开网页界面（服务端口 3000）："
echo ""
echo " 方式一（推荐）：AutoDL 实例详情页 → 自定义服务/端口映射"
echo "                 → 添加端口 3000 → 点击生成的链接访问"
echo ""
echo " 方式二：SSH 隧道（在你自己电脑执行）"
echo "         ssh -p <SSH端口> -L 3000:localhost:3000 root@<SSH地址>"
echo "         然后浏览器打开 http://localhost:3000"
echo ""
echo " 停止服务：bash /root/taotao-transcoder/stop.sh"
echo " 详细说明：cat /root/使用说明.txt"
echo "============================================================"
