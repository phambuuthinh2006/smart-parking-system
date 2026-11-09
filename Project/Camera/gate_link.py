"""gate_link.py: Lắng nghe trạng thái mở/đóng barrier từ Web Backend và gửi lệnh HTTP sang ESP32.
Hỗ trợ cả chế độ chạy luồng ngầm (tích hợp trong main.py) lẫn chạy file độc lập.
"""
import argparse
import json
import threading
import time
from urllib import request
from web_link import HttpLink, load_settings


class GatePlan:
    def __init__(self):
        self.version = None
        self.fire_sent = False

    def reset(self):
        self.version = None
        self.fire_sent = False

    def next(self, state):
        gate = state.get("barrier", {})
        version = gate.get("version")
        if type(version) is not int or version < 0:
            return None

        previous, self.version = self.version, version
        fire = bool(gate.get("fireOverride"))

        if fire:
            if not self.fire_sent:
                self.fire_sent = True
                return "open"
            return None

        self.fire_sent = False
        if previous is None or version <= previous:
            return None

        if gate.get("position") == "OPEN":
            return "open"

        events = state.get("events", [])
        if events and events[0].get("kind") in ("PASSAGE", "CLOSE") and events[0].get("outcome") in ("PASSAGE_CONFIRMED", "CANCELLED_CLOSE"):
            return "close"

        return None


def send_esp_command(opener, esp_url, command, key=""):
    path = "/close" if command == "close" else "/open"
    headers = {"Content-Type": "application/json"}
    if key:
        headers["X-Device-Key"] = key

    req = request.Request(
        esp_url.rstrip("/") + path,
        data=b"",
        method="POST",
        headers=headers
    )
    with opener.open(req, timeout=2.5) as response:
        result = json.load(response)

    status = result.get("status")
    if status not in ("APPLIED", "COMMAND_RECEIVED"):
        raise ValueError(f"ESP32 phản hồi trạng thái lạ: {status}")
    return result


class GateLinkRunner:
    def __init__(self, esp_url=None, backend=None):
        config = load_settings()
        self.esp_url = esp_url or config.get("ESP32_URL", "http://192.168.4.1")
        self.esp_key = config.get("ESP32_API_KEY", "")
        self.backend = backend or HttpLink()
        self.plan = GatePlan()
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        print(f"[GATE LINK] Đã kích hoạt cầu nối Web <-> ESP32 ({self.esp_url})", flush=True)

    def stop(self):
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)

    def _run_loop(self):
        offline = False
        while not self.stop_event.is_set():
            try:
                state = self.backend.call("/api/access/status")
                command = self.plan.next(state)
                if command:
                    res = send_esp_command(self.backend.opener, self.esp_url, command, self.esp_key)
                    print(f"\n>>> [GATE LINK] Đã chuyển lệnh '{command.upper()}' sang ESP32! Phản hồi: {res.get('status')}", flush=True)
                offline = False
            except Exception as exc:
                self.plan.reset()
                if not offline:
                    # In thông báo ngắn gọn khi chưa kết nối được
                    print(f"[GATE LINK] Đang chờ kết nối Web Backend/ESP32 ({type(exc).__name__})...", flush=True)
                    offline = True
                time.sleep(1.5)

            time.sleep(0.5)


def start_gate_link(esp_url=None):
    runner = GateLinkRunner(esp_url=esp_url)
    runner.start()
    return runner


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--esp-url", default="http://192.168.4.1", help="Địa chỉ IP của ESP32")
    args = parser.parse_args()

    runner = GateLinkRunner(esp_url=args.esp_url)
    runner.start()
    print("Gate Link đang chạy độc lập. Nhấn Ctrl+C để dừng.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        runner.stop()
        print("\nĐã dừng Gate Link.")


if __name__ == "__main__":
    main()

