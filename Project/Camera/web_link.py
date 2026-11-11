"""web_link.py: Gửi kết quả biển số nhận diện từ Camera lên Web Backend qua HTTP.
Chạy trên một Thread nền riêng (Worker Thread) để không làm giảm FPS hay giật lag khung hình camera.
"""
import argparse
import json
import os
import queue
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, error


def describe_http_error(exc):
    if isinstance(exc, error.HTTPError):
        hint = {401: "API key không khớp backend thử nghiệm", 403: "Backend từ chối quyền truy cập",
                404: "Không có API này: kiểm tra đúng backend thử nghiệm", 400: "Dữ liệu/config không đúng: kiểm tra AUTO và firmware protocol 3",
                409: "Trạng thái đã thay đổi; tải lại và kiểm tra lượt đang chờ"}.get(exc.code, "Backend trả lỗi")
        return f"HTTP {exc.code}: {hint}"
    if isinstance(exc, error.URLError):
        reason = exc.reason
        code = getattr(reason, 'winerror', None) or getattr(reason, 'errno', None)
        return f"URLError: {type(reason).__name__}" + (f" ({code})" if code else "")
    return str(exc) if isinstance(exc, ValueError) else type(exc).__name__


def load_settings():
    """Đọc mặc định từ gốc dự án, rồi ghi đè bằng cấu hình gần camera hơn."""
    values = {}
    search_paths = [
        Path(__file__).resolve().parent / ".env",
        Path(__file__).resolve().parents[1] / ".env",
        Path(__file__).resolve().parents[2] / ".env",
    ]
    for env_path in reversed(search_paths):
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8-sig").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip("\"'")
                    if key in ("DEVICE_API_KEY", "DEVICE_BACKEND_URL", "PARKING_DIRECTION", "ESP32_URL", "ESP32_API_KEY"):
                        values[key] = value

    # Ghi đè bởi biến môi trường hệ thống nếu có
    for key in ("DEVICE_API_KEY", "DEVICE_BACKEND_URL", "PARKING_DIRECTION", "ESP32_URL", "ESP32_API_KEY"):
        if key in os.environ:
            values[key] = os.environ[key]
    return values


class HttpLink:
    def __init__(self):
        config = load_settings()
        self.base = config.get("DEVICE_BACKEND_URL", "http://192.168.4.2:18081").rstrip("/")
        self.key = config.get("DEVICE_API_KEY", "")
        self.direction = config.get("PARKING_DIRECTION", "AUTO")
        if self.direction not in ("AUTO", "ENTRY", "EXIT"):
            raise ValueError("PARKING_DIRECTION must be AUTO, ENTRY or EXIT")

        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self, *args):
                return None

        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def verify_experiment(self):
        state = self.call("/api/access/status")
        stats = state.get("stats", {})
        if stats.get("capacity") != 1 or "pendingParking" not in stats:
            raise ValueError("Đang trỏ backend bản gốc. Sửa DEVICE_BACKEND_URL tới IP máy web cổng 18081 và dùng API key thử nghiệm.")
        if self.direction != "AUTO":
            raise ValueError("Bản thử nghiệm cần PARKING_DIRECTION=AUTO trong Camera/.env")
        return state


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


class CameraEncounter:
    """No new encounter until consecutive observed empty frames span two seconds.

    Uses plate REGION presence, not OCR success, so OCR noise is not a departure.
    """
    def __init__(self, on_new_encounter=None):
        self.id = str(uuid.uuid4())
        self.empty_since = None
        self.cleared = False
        self.on_new_encounter = on_new_encounter

    def observe(self, present, now):
        if present:
            if self.cleared:
                self.id = str(uuid.uuid4())
                if callable(self.on_new_encounter):
                    self.on_new_encounter()
            self.empty_since = None
            self.cleared = False
        else:
            if self.empty_since is None:
                self.empty_since = now
            elif now-self.empty_since >= 2:
                self.cleared = True
        return self.id


class PlateUploader:
    def __init__(self, link=None):
        self.link = link or HttpLink()
        self.pending = queue.Queue(maxsize=1)
        self.stop_event = threading.Event()
        self.last_text = None
        self.last_at = 0
        self.recent = {}
        self.last_result = None
        self.encounter_locked = False
        self.encounter = CameraEncounter(on_new_encounter=self.unlock_encounter)
        self.thread = threading.Thread(target=self._send_loop, daemon=True)
        self.thread.start()

    def lock_encounter(self):
        self.encounter_locked = True

    def unlock_encounter(self):
        self.encounter_locked = False

    def observe_frame(self, plate_region_present):
        return self.encounter.observe(plate_region_present, time.monotonic())

    def submit(self, text):
        """Gửi biển số đọc được vào hàng đợi với cơ chế chống spam (cooldown 3s cùng 1 biển)."""
        text = str(text).strip()
        now = time.monotonic()
        normalized = "".join(c for c in text.upper() if c not in " .-\t\r\n")

        # 1. Lọc định dạng biển số hợp lệ (2 số, 1-2 chữ, 4-6 số)
        if not re.match(r'^\d{2}[A-Z]{1,2}\d{4,6}$', normalized):
            return

        # 2. Kiểm tra khóa encounter: Đã được Backend duyệt thì không gửi spam nữa
        if self.encounter_locked:
            return

        if not text or len(text) > 100 or now-self.recent.get(normalized, float('-inf')) < 3:
            return
        self.recent = {key: at for key, at in self.recent.items() if now-at < 3}
        self.recent[normalized] = now
        self.last_text = text
        self.last_at = now

        event = {
            "eventId": str(uuid.uuid4()),
            "plateText": text,
            "direction": self.link.direction,
            "encounterId": self.encounter.id,
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
                result_key = (result.get('plate') or event['plateText'], outcome)
                if result_key != self.last_result:
                    print(f"[HTTP CAMERA] Đã gửi biển '{event['plateText']}' -> Web phản hồi: {outcome}", flush=True)
                    self.last_result = result_key

                # Nếu Backend duyệt thành công -> khóa encounter để tránh OCR rác ghi đè
                if outcome in ("ENTRY_PENDING", "EXIT_PENDING", "WAITING_PARKING", "ENCOUNTER_USED"):
                    self.lock_encounter()
                    print(f"[HTTP CAMERA] Đã khóa encounter ({outcome}) - Tạm ngừng gửi đọc biển cho tới khi xe mới tới", flush=True)

                offline = False
            except Exception as exc:
                if not offline:
                    print(f"[HTTP CAMERA] Chưa kết nối được Web Backend ({describe_http_error(exc)}). Đang thử lại...", flush=True)
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
    link.verify_experiment()
    if args.register or args.disable:
        plate = args.register or args.disable
        res = link.call("/api/device/registered-plates", {"plate": plate, "enabled": bool(args.register)})
        print(f"Đã lưu đăng ký biển: {res.get('plate')} (enabled={res.get('enabled')})")
    else:
        res = link.call("/api/device/plate-readings", {
            "eventId": str(uuid.uuid4()),
            "plateText": args.send,
            "direction": link.direction,
            "encounterId": str(uuid.uuid4()),
            "observedAt": datetime.now(timezone.utc).isoformat()
        })
        print(f"Kết quả gửi biển '{args.send}': {res.get('outcome')}")

