# -*- coding: utf-8 -*-
# TEMP 手机端调试用：静态托管站点 + 接收手机回传的埋点日志（定位后删除）
import http.server
import socketserver
import os
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phone-debug.log')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8011

open(LOG, 'a', encoding='utf-8').write('\n===== server start =====\n')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _save(self, body):
        try:
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write(body + '\n')
        except Exception:
            pass

    def do_POST(self):
        n = int(self.headers.get('Content-Length', '0') or '0')
        body = self.rfile.read(n).decode('utf-8', 'replace') if n else ''
        self._save(body)
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/log.gif'):
            q = urllib.parse.urlparse(self.path).query
            data = urllib.parse.parse_qs(q).get('d', [''])[0]
            self._save(data)
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            return
        return super().do_GET()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


print('serving', ROOT, 'on 0.0.0.0:%d' % PORT)
with Server(('0.0.0.0', PORT), Handler) as httpd:
    httpd.serve_forever()
