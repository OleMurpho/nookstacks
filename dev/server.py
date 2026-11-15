#!/usr/bin/env python3
"""
Tartaros server: serves the app and keeps the vault on disk.

    python3 dev/server.py [port]

Layout
    web/                     static app
    vault/state.json         the whole board (levels -> projects -> regions/docs)
    vault/state.json.bak     previous good copy, written on every save
    vault/blobs/<id>         imported file bytes, content addressed by doc id
    vault/history/<ts>.json  rolling saves (last 40)

API
    GET    /api/state           -> {"ok":true,"state":{...}|null,"saved":"ISO time"}
    PUT    /api/state           <- {"state":{...}}
    GET    /api/blob/<id>       -> raw bytes
    PUT    /api/blob/<id>       <- raw bytes
    DELETE /api/blob/<id>
    GET    /api/health          -> {"ok":true,"version":1}
"""
import json
import os
import shutil
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(ROOT), "web")
VAULT = os.environ.get("TARTAROS_VAULT") or os.path.join(os.path.dirname(ROOT), "vault")
BLOBS = os.path.join(VAULT, "blobs")
HISTORY = os.path.join(VAULT, "history")
STATE = os.path.join(VAULT, "state.json")
BACKUP = STATE + ".bak"
KEEP_HISTORY = 40
MAX_STATE = 64 * 1024 * 1024
MAX_BLOB = 512 * 1024 * 1024

lock = threading.Lock()


def ensure_dirs():
    for d in (VAULT, BLOBS, HISTORY):
        os.makedirs(d, exist_ok=True)


def atomic_write(path, data: bytes):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_state():
    if not os.path.exists(STATE):
        return None, None
    with open("rb") if False else open(STATE, "rb") as f:
        raw = f.read()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return None, None
    return data, datetime.fromtimestamp(os.path.getmtime(STATE), timezone.utc).isoformat()


def write_state(state):
    ensure_dirs()
    payload = json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with lock:
        if os.path.exists(STATE):
            try:
                shutil.copy2(STATE, BACKUP)
            except OSError:
                pass
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            try:
                shutil.copy2(STATE, os.path.join(HISTORY, stamp + ".json"))
                snaps = sorted(os.listdir(HISTORY))
                for old in snaps[:-KEEP_HISTORY]:
                    os.remove(os.path.join(HISTORY, old))
            except OSError:
                pass
        atomic_write(STATE, payload)
    return len(payload)


class Handler(SimpleHTTPRequestHandler):
    server_version = "Tartaros/1.0"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---------- helpers ----------
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self, limit):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0:
            return b""
        if n > limit:
            self._json({"ok": False, "error": "too large"}, 413)
            return None
        return self.rfile.read(n)

    def _path_is_api(self):
        return self.path.startswith("/api/")

    # ---------- verbs ----------
    def do_GET(self):
        if self.path == "/api/health":
            return self._json({"ok": True, "version": 1, "vault": VAULT})
        if self.path == "/api/state":
            state, saved = read_state()
            return self._json({"ok": True, "state": state, "saved": saved})
        if self.path.startswith("/api/blob/"):
            bid = self.path[len("/api/blob/"):].split("?")[0]
            if not bid or "/" in bid or ".." in bid:
                return self._json({"ok": False, "error": "bad id"}, 400)
            fp = os.path.join(BLOBS, bid)
            if not os.path.exists(fp):
                return self._json({"ok": False, "error": "not found"}, 404)
            with open(fp, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        if self._path_is_api():
            return self._json({"ok": False, "error": "unknown"}, 404)
        return super().do_GET()

    def do_PUT(self):
        if self.path == "/api/state":
            raw = self._body(MAX_STATE)
            if raw is None:
                return
            try:
                payload = json.loads(raw.decode("utf-8"))
                state = payload["state"] if isinstance(payload, dict) and "state" in payload else payload
                if not isinstance(state, dict) or "levels" not in state:
                    raise ValueError("state must contain levels")
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 400)
            size = write_state(state)
            return self._json({"ok": True, "bytes": size,
                               "saved": datetime.now(timezone.utc).isoformat()})
        if self.path.startswith("/api/blob/"):
            bid = self.path[len("/api/blob/"):].split("?")[0]
            if not bid or "/" in bid or ".." in bid:
                return self._json({"ok": False, "error": "bad id"}, 400)
            raw = self._body(MAX_BLOB)
            if raw is None:
                return
            ensure_dirs()
            atomic_write(os.path.join(BLOBS, bid), raw)
            return self._json({"ok": True, "bytes": len(raw)})
        return self._json({"ok": False, "error": "unknown"}, 404)

    def do_DELETE(self):
        if self.path.startswith("/api/blob/"):
            bid = self.path[len("/api/blob/"):].split("?")[0]
            fp = os.path.join(BLOBS, bid)
            if os.path.exists(fp):
                os.remove(fp)
                return self._json({"ok": True})
            return self._json({"ok": False, "error": "not found"}, 404)
        return self._json({"ok": False, "error": "unknown"}, 404)

    def do_HEAD(self):
        return self.do_GET()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    ensure_dirs()
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    state, saved = read_state()
    n = len(state["levels"]) if state else 0
    print(f"Tartaros on http://localhost:{port}   vault: {VAULT}   levels: {n}   saved: {saved or 'never'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
