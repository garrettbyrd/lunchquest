#!/usr/bin/env python3
"""Tiny no-cache static server for Lunchquest. Localhost only."""
import functools, http.server, os, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()
    def log_message(self, *a):
        pass

class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

handler = functools.partial(H, directory=os.path.dirname(os.path.abspath(__file__)))
with S(('127.0.0.1', PORT), handler) as httpd:
    print(f'lunchquest on http://127.0.0.1:{PORT}/', flush=True)
    httpd.serve_forever()
