"""gate_link.py: Lắng nghe trạng thái mở/đóng barrier từ Web Backend và gửi lệnh HTTP sang ESP32.
Hỗ trợ cả chế độ chạy luồng ngầm (tích hợp trong main.py) lẫn chạy file độc lập.
"""
import argparse
import json
import threading
import time
from urllib import request, parse
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


def send_esp_command(opener, esp_url, command, key="", request_id=None):
    path = "/close" if command == "close" else "/open"
    if request_id:
        path += "?" + parse.urlencode({"requestId": request_id})
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
    if request_id and result.get("requestId") != request_id:
        raise ValueError("ESP firmware must support correlated requestId (protocol 2)")
    return result


def read_hardware(opener, esp_url, key=""):
    req = request.Request(esp_url.rstrip("/") + "/status", headers={"X-Device-Key": key})
    with opener.open(req, timeout=2.5) as response:
        status = json.load(response)
    if status.get("protocolVersion") != 3:
        raise ValueError("Upload the new Uno + ESP8266 firmware (experimental protocolVersion 3)")
    age = status.get("sampleAgeMs")
    if status.get("telemetryValid") is not True or type(age) is not int or not 0 <= age <= 2000:
        raise ValueError("Uno telemetry is missing or stale; check UART and both firmwares")
    if status.get("gate") not in ("OPEN", "CLOSED") or status.get("phase") not in (
        "IDLE", "WAITING", "OPEN", "PASSED", "CANCELLED", "BLOCKED"
    ):
        raise ValueError("Invalid gate telemetry")
    if status.get("slot") not in ("AVAILABLE", "OCCUPIED", "UNKNOWN") or type(status.get("gatePresent")) is not bool or type(status.get("gateSensorValid")) is not bool or type(status.get("slotSensorValid")) is not bool:
        raise ValueError("Protocol 3 sensor fields are missing")
    return status


class AutomaticCycle:
    """Retain a bounded retry only for an idempotent, newly observed command."""
    def __init__(self):
        self.pending = None
        self.last_feedback = 0

    def feedback(self, state, hardware):
        b = state["barrier"]
        return {"requestId": hardware.get("requestId") or None,
                "expectedVersion": b["version"], "visitId": b.get("pendingVisitId"),
                "gate": hardware["gate"], "phase": hardware["phase"],
                "sampleAgeMs": hardware["sampleAgeMs"],
                "slotStatus": hardware["slot"] if hardware["slotSensorValid"] else "UNKNOWN",
                "gatePresent": hardware["gatePresent"], "gateSensorValid": hardware["gateSensorValid"]}

    def opening(self, state, hardware, command, now):
        b = state["barrier"]
        if command == "open" and b.get("requestId") and not b.get("fireOverride"):
            self.pending = (b["requestId"], b["version"], now)
        if self.pending:
            token, version, started = self.pending
            if b["version"] != version or b["position"] != "OPEN" or b.get("fireOverride") or now-started >= 30:
                self.pending = None
            elif hardware.get("requestId") == token:
                self.pending = None  # Uno acknowledged it; never reopen a completed cycle.
            else:
                return token
        return None


class GateLinkRunner:
    def __init__(self, esp_url=None, backend=None):
        config = load_settings()
        self.esp_url = esp_url or config.get("ESP32_URL", "http://192.168.4.1")
        self.esp_key = config.get("ESP32_API_KEY", "")
        self.backend = backend or HttpLink()
        self.plan = GatePlan()
        self.auto = AutomaticCycle()
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        print(f"[GATE LINK] Backend: {self.backend.base}; ESP: {self.esp_url}; automatic cycle feedback enabled", flush=True)

    def stop(self):
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)

    def _run_loop(self):
        last_error = None
        connected = False
        while not self.stop_event.is_set():
            stage = "backend"
            try:
                state = self.backend.call("/api/access/status")
                command = self.plan.next(state)
                observed_version = state["barrier"]["version"]
                self.auto.opening(state, {}, command, time.monotonic())
                stage = "ESP /status / Uno telemetry"
                physical = read_hardware(self.backend.opener, self.esp_url, self.esp_key)
                now = time.monotonic()
                if now-self.auto.last_feedback >= 1:
                    stage = "backend /device/barrier-feedback"
                    result = self.backend.call("/api/device/barrier-feedback", self.auto.feedback(state, physical))
                    self.auto.last_feedback = now
                    if result.get("outcome") in ("GATE_ENTERED", "AUTO_PASSAGE_CONFIRMED", "AUTO_CANCELLED_CLOSE"):
                        print(f"[GATE LINK] {result['outcome']}: visit synchronized automatically", flush=True)
                    state = result["snapshot"]["access"]
                    if state["barrier"]["version"] != observed_version:
                        command = self.plan.next(state)
                token = self.auto.opening(state, physical, None, now)
                stage = "ESP command"
                if token or (command and (not state["barrier"].get("requestId") or state["barrier"].get("fireOverride"))):
                    sent = command or "open"
                    res = send_esp_command(self.backend.opener, self.esp_url, sent, self.esp_key, token)
                    print(f"\n>>> [GATE LINK] Đã chuyển lệnh '{sent.upper()}' sang ESP32! Phản hồi: {res.get('status')}", flush=True)
                if not connected:
                    print("[GATE LINK] Connected: backend + fresh Uno telemetry", flush=True)
                connected = True
                last_error = None
            except Exception as exc:
                connected = False
                # Never replay a backend request seen before the first successful poll.
                error = (stage, type(exc).__name__)
                if error != last_error:
                    detail = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
                    print(f"[GATE LINK] Error at {stage}: {detail}", flush=True)
                    last_error = error
                self.stop_event.wait(1.5)

            self.stop_event.wait(0.5)


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

