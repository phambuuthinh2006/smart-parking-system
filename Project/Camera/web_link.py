"""web_link.py: Gửi kết quả biển số nhận diện từ Camera lên Web Backend qua HTTP.
Chạy trên một Thread nền riêng (Worker Thread) để không làm giảm FPS hay giật lag khung hình camera.
"""
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


def load_settings():
    """Tìm đọc file .env từ thư mục hiện tại hoặc các thư mục cha."""
    values = {}
    search_paths = [
        Path(__file__).resolve().parent / ".env",
        Path(__file__).resolve().parents[1] / ".env",
        Path(__file__).resolve().parents[2] / ".env",
    ]
    for env_path in search_paths:
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip("\"'")
                    if key in ("DEVICE_API_KEY", "DEVICE_BACKEND_URL", "PARKING_DIRECTION", "ESP32_URL", "ESP32_API_KEY"):
                        values.setdefault(key, value)
            break

    # Ghi đè bởi biến môi trường hệ thống nếu có
    for key in ("DEVICE_API_KEY", "DEVICE_BACKEND_URL", "PARKING_DIRECTION", "ESP32_URL", "ESP32_API_KEY"):
        if key in os.environ:
            values[key] = os.environ[key]
    return values


class HttpLink:
    def __init__(self):
        config = load_settings()
        self.base = config.get("DEVICE_BACKEND_URL", "http://192.168.4.2:18080").rstrip("/")
        self.key = config.get("DEVICE_API_KEY", "")
        self.direction = config.get("PARKING_DIRECTION", "ENTRY")
        if self.direction not in ("ENTRY", "EXIT"):
            self.direction = "ENTRY"

        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self, *args):
                return None

        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def call(self, path, body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.key:
            headers["X-Device-Key"] = self.key

        req = request.Request(
            self.base + path,
            data=data,
            headers=headers,
            method="GET" if body is None else "POST"
        )
        with self.opener.open(req, timeout=2.5) as response:
            return json.load(response)


class PlateUploader:
    def __init__(self, link=None):
        self.link = link or HttpLink()
        self.pending = queue.Queue(maxsize=1)
        self.stop_event = threading.Event()
        self.last_text = None
        self.last_at = 0
        self.thread = threading.Thread(target=self._send_loop, daemon=True)
        self.thread.start()

    def submit(self, text):
        """Gửi biển số đọc được vào hàng đợi với cơ chế chống spam (cooldown 3s cùng 1 biển)."""
        text = str(text).strip()
        now = time.monotonic()
        if not text or len(text) > 100 or (text == self.last_text and now - self.last_at < 3.0):
            return
        self.last_text = text
        self.last_at = now

        event = {
            "eventId": str(uuid.uuid4()),
            "plateText": text,
            "direction": self.link.direction,
            "observedAt": datetime.now(timezone.utc).isoformat()
        }

        # Đẩy vào queue, nếu queue đầy thì bỏ cái cũ lấy cái mới nhất
        try:
            self.pending.put_nowait(event)
        except queue.Full:
            try:
                self.pending.get_nowait()
            except queue.Empty:
                pass
            try:
                self.pending.put_nowait(event)
            except queue.Full:
                pass

    def _send_loop(self):
        offline = False
        while not self.stop_event.is_set():
            try:
                event = self.pending.get(timeout=0.2)
            except queue.Empty:
                continue

            try:
                result = self.link.call("/api/device/plate-readings", event)
                outcome = result.get("outcome", "RECEIVED")
                print(f"[HTTP CAMERA] Đã gửi biển '{event['plateText']}' -> Web phản hồi: {outcome}", flush=True)
                offline = False
            except Exception as exc:
                if not offline:
                    print(f"[HTTP CAMERA] Chưa kết nối được Web Backend ({type(exc).__name__}). Đang thử lại...", flush=True)
                    offline = True

    def close(self):
        self.stop_event.set()
        self.thread.join(timeout=2.0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Kiểm tra gửi kết quả nhận diện biển số hoặc đăng ký xe.")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--register", help="Đăng ký biển số vào hệ thống, ví dụ: 43A-123.45")
    action.add_argument("--disable", help="Hủy kích hoạt biển số, ví dụ: 43A-123.45")
    action.add_argument("--send", help="Thử gửi một chuỗi biển số lên web, ví dụ: 43A-123.45")
    args = parser.parse_args()

    link = HttpLink()
    if args.register or args.disable:
        plate = args.register or args.disable
        res = link.call("/api/device/registered-plates", {"plate": plate, "enabled": bool(args.register)})
        print(f"Đã lưu đăng ký biển: {res.get('plate')} (enabled={res.get('enabled')})")
    else:
        res = link.call("/api/device/plate-readings", {
            "eventId": str(uuid.uuid4()),
            "plateText": args.send,
            "direction": link.direction,
            "observedAt": datetime.now(timezone.utc).isoformat()
        })
        print(f"Kết quả gửi biển '{args.send}': {res.get('outcome')}")

