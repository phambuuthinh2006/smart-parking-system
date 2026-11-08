"""Upload the existing OCR output to the web without blocking the camera loop."""
import argparse
import json
import os
import queue
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib import request


def settings():
    values = {}
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                if key.strip() in ("DEVICE_API_KEY", "DEVICE_BACKEND_URL", "PARKING_DIRECTION"):
                    values[key.strip()] = value.strip().strip("\"'")
    for key in ("DEVICE_API_KEY", "DEVICE_BACKEND_URL", "PARKING_DIRECTION"):
        if key in os.environ: values[key] = os.environ[key]
    return values


class HttpLink:
    def __init__(self):
        config = settings()
        self.base = config.get("DEVICE_BACKEND_URL", "http://127.0.0.1:18080").rstrip("/")
        self.key = config.get("DEVICE_API_KEY", "")
        self.direction = config.get("PARKING_DIRECTION", "ENTRY")
        if self.direction not in ("ENTRY", "EXIT"): raise ValueError("PARKING_DIRECTION must be ENTRY or EXIT")
        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self, *args): return None
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def call(self, path, body=None):
        if len(self.key) < 24: raise ValueError("Configure DEVICE_API_KEY in project .env")
        req = request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-Device-Key": self.key},
            method="GET" if body is None else "POST")
        with self.opener.open(req, timeout=2) as response: return json.load(response)


class PlateUploader:
    def __init__(self, link=None):
        self.link = link or HttpLink()
        self.pending = queue.Queue(maxsize=1)
        self.stop = threading.Event()
        self.last_text, self.last_at = None, 0
        self.thread = threading.Thread(target=self._send, daemon=True)
        self.thread.start()

    def submit(self, text):
        # Only transport throttling. No changes to YOLO/OCR output or thresholds.
        text = str(text).strip()
        now = time.monotonic()
        if not text or len(text) > 100 or (text == self.last_text and now-self.last_at < 3): return
        self.last_text, self.last_at = text, now
        event = {"eventId": str(uuid.uuid4()), "plateText": text, "direction": self.link.direction,
                 "observedAt": datetime.now(timezone.utc).isoformat()}
        try: self.pending.put_nowait(event)
        except queue.Full:
            try: self.pending.get_nowait()
            except queue.Empty: pass
            try: self.pending.put_nowait(event)
            except queue.Full: pass

    def _send(self):
        offline = False
        while not self.stop.is_set():
            try: event = self.pending.get(timeout=.2)
            except queue.Empty: continue
            try:
                result = self.link.call("/api/device/plate-readings", event)
                print("Web:", result.get("outcome", "received"), flush=True)
                offline = False
            except Exception as exc:
                if not offline: print(f"Web unavailable ({type(exc).__name__}); camera continues.", flush=True)
                offline = True
                # Do not replay an old image after recovery; future frames provide fresh readings.

    def close(self):
        self.stop.set()
        self.thread.join(timeout=2.5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Register a plate or upload one text reading to the web.")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--register")
    action.add_argument("--disable")
    action.add_argument("--send")
    args = parser.parse_args()
    link = HttpLink()
    if args.register or args.disable:
        result = link.call("/api/device/registered-plates", {"plate": args.register or args.disable, "enabled": bool(args.register)})
        print("Registration saved:", result["plate"], "enabled=" + str(result["enabled"]))
    else:
        result = link.call("/api/device/plate-readings", {"eventId": str(uuid.uuid4()), "plateText": args.send,
            "direction": link.direction, "observedAt": datetime.now(timezone.utc).isoformat()})
        print("Web:", result["outcome"])
