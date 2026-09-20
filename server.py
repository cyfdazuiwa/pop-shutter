#!/usr/bin/env python3
"""波普快门本地服务器：发送 no-cache 头，保证浏览器总是加载最新页面。"""
import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = 8137


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print(f'波普快门本地服务已启动：http://127.0.0.1:{PORT}')
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
