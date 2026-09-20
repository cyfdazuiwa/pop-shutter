#!/bin/bash
# 波普快门 —— 双击启动本地服务并打开浏览器
cd "$(dirname "$0")" || exit 1

PORT=8137
if ! command -v python3 >/dev/null 2>&1; then
  echo "需要 python3（macOS 自带）。也可改用其他静态服务器。"
  exit 1
fi

nohup python3 server.py >/dev/null 2>&1 &
sleep 0.6
open "http://127.0.0.1:$PORT"
echo "已启动：http://127.0.0.1:$PORT （停止服务请运行：killall -f 'python3 server.py'）"
