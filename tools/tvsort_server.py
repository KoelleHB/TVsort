#!/usr/bin/env python3
"""TVsort local-only browser server. Never binds to a network interface."""
import argparse
import io
import json
import secrets
import shutil
import tempfile
import threading
from datetime import datetime
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

from tvsort_bridge import DEFAULT_VOLUME, EXPECTED, FAVORITE, backup, check_device, deploy, mounted_volume

MAX_UPLOAD = 12 * 1024 * 1024
ROOT = Path(__file__).resolve().parent.parent
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
}
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.Lock()

class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

class Handler(BaseHTTPRequestHandler):
    volume = DEFAULT_VOLUME
    backups = Path.home() / "philips-debloat" / "channelmaps" / "bridge-backups"
    baseline_hash = None

    def respond(self, status, payload, media="application/json; charset=utf-8", extra=None):
        body = json.dumps(payload, ensure_ascii=False).encode() if isinstance(payload, (dict, list)) else payload
        self.send_response(status)
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cdn.jsdelivr.net; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        if extra:
            for name, value in extra.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def authorized_host(self):
        host = self.headers.get("Host", "")
        return host in ("127.0.0.1:8765", "localhost:8765")

    def safe_origin(self):
        origin = self.headers.get("Origin", "")
        return not origin or origin in ("http://127.0.0.1:8765", "http://localhost:8765")

    def do_GET(self):
        if not self.authorized_host() or not self.safe_origin():
            return self.respond(403, {"error": "Unzulässiger Host oder Origin."})
        path = urlsplit(self.path).path
        if path in STATIC_FILES:
            filename, media = STATIC_FILES[path]
            return self.respond(200, (ROOT / filename).read_bytes(), media)
        if path == "/api/status":
            try:
                check_device()
                mounted_volume(self.volume)
                return self.respond(200, {"connected": True, "volume": self.volume, "token": TOKEN})
            except Exception as ex:
                return self.respond(200, {"connected": False, "volume": self.volume, "token": TOKEN, "error": str(ex)})
        return self.respond(404, {"error": "Nicht gefunden"})

    def do_POST(self):
        if not self.authorized_host() or not self.safe_origin():
            return self.respond(403, {"error": "Unzulässiger Host oder Origin."})
        if self.headers.get("X-TVsort-Token") != TOKEN:
            return self.respond(403, {"error": "Sitzungstoken fehlt oder ist ungültig."})
        path = urlsplit(self.path).path
        if path not in ("/api/load", "/api/backup", "/api/apply"):
            return self.respond(404, {"error": "Nicht gefunden"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > MAX_UPLOAD:
                return self.respond(413, {"error": "Anfrage zu groß."})
            if path == "/api/apply" and (length == 0 or self.headers.get("Content-Type") != "application/zip"):
                return self.respond(400, {"error": "Gültige ZIP-Daten erforderlich."})
            with LOCK:
                check_device()
                mounted_volume(self.volume)
                if path == "/api/load":
                    saved = self.save_backup("load")
                    body = io.BytesIO()
                    with ZipFile(body, "w", ZIP_DEFLATED) as zipfile:
                        for rel in sorted(EXPECTED):
                            zipfile.write(saved / rel, rel)
                    self.baseline_hash = sha256((saved / FAVORITE).read_bytes()).hexdigest()
                    return self.respond(200, body.getvalue(), "application/zip",
                                        {"X-TVsort-Baseline": self.baseline_hash})
                if path == "/api/backup":
                    saved = self.save_backup("manual")
                    return self.respond(200, {"ok": True, "backup": str(saved)})
                if not self.baseline_hash:
                    return self.respond(409, {"error": "Zuerst 'Vom USB laden' wählen."})
                if self.headers.get("X-TVsort-Baseline") != self.baseline_hash:
                    return self.respond(409, {"error": "USB-Ausgangszustand stimmt nicht mit dieser Sitzung überein."})
                if self.headers.get("X-TVsort-Confirm") != "JA":
                    return self.respond(403, {"error": "Ausdrückliche Schreibbestätigung fehlt."})
                data = self.rfile.read(length)
                if len(data) != length:
                    return self.respond(400, {"error": "ZIP unvollständig."})
                with tempfile.TemporaryDirectory(prefix="tvsort-upload-") as tmp:
                    candidate = Path(tmp) / "edited.zip"
                    candidate.write_bytes(data)
                    # Prevent stale browser edits from overwriting a newer USB export.
                    with tempfile.TemporaryDirectory(prefix="tvsort-check-") as temp:
                        from tvsort_bridge import adb
                        current = Path(temp) / "Favorite.xml"
                        adb("pull", mounted_volume(self.volume) + "/" + FAVORITE, str(current))
                        if sha256(current.read_bytes()).hexdigest() != self.baseline_hash:
                            return self.respond(409, {"error": "USB-Favoriten wurden zwischenzeitlich geändert. Bitte neu laden."})
                    deploy(self.volume, candidate, self.backups, confirmed=True)
                # Never allow a second write without reloading the USB dataset.
                self.baseline_hash = None
                return self.respond(200, {"ok": True, "message": "Favorite.xml verifiziert auf USB übertragen. Import am Philips manuell starten."})
        except Exception as ex:
            return self.respond(500, {"error": str(ex)})

    def save_backup(self, prefix):
        self.backups.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        return backup(self.volume, self.backups / (prefix + "-" + stamp))

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--volume", default=DEFAULT_VOLUME)
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    if args.port != 8765:
        p.error("In dieser Version wird ausschließlich Port 8765 unterstützt.")
    Handler.volume = args.volume
    print("TVsort lokal starten: http://localhost:8765")
    print("Nur Loopback. Webapp + ADB-Bridge unter derselben lokalen Adresse.")
    print("Mit Strg+C beenden.")
    with LocalServer(("127.0.0.1", args.port), Handler) as server:
        server.serve_forever()

if __name__ == "__main__":
    main()
