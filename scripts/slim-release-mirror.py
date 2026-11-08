"""Local-only transport bridge. Supabase still verifies its pinned archive/manifest hashes."""
import http.server
import pathlib
import re
import shutil
import threading
import urllib.request

CACHE = pathlib.Path('/mnt/d/Codex/.toolchains/downloads/slim-services')
CACHE.mkdir(parents=True, exist_ok=True)
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({'https': 'http://127.0.0.1:7897'}))
LOCK = threading.Lock()


class Mirror(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        key = self.path.lstrip('/')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.(?:manifest\.json|tar\.zst)', key):
            self.send_error(404)
            return
        target = CACHE / key
        try:
            with LOCK:
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with OPENER.open('https://github.com/supabase/slim-services/releases/download/' + key, timeout=120) as remote:
                        temporary = target.with_suffix(target.suffix + '.part')
                        with temporary.open('wb') as output:
                            shutil.copyfileobj(remote, output, 512 * 1024)
                        temporary.replace(target)
                    print('Downloaded official artifact: ' + target.name, flush=True)
            self.send_response(200)
            self.send_header('Content-Length', str(target.stat().st_size))
            self.end_headers()
            with target.open('rb') as source:
                shutil.copyfileobj(source, self.wfile, 512 * 1024)
        except Exception as error:
            print('Artifact transport failed: ' + type(error).__name__, flush=True)
            self.send_error(502)

    def log_message(self, *_):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', 18555), Mirror).serve_forever()
