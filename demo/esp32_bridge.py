"""Laptop adapter: backend desired gate state <-> authenticated ESP32 HTTP.

Explicitly starting this process enables hardware commands. No ML dependencies.
A new backend barrier version is required after startup/reconnection. Closing is
sent only for a fresh operator CLOSE/PASSAGE event; never inferred from cooling.
"""
import argparse
import json
import math
import os
import time
from pathlib import Path
from urllib import request, parse


def settings_file(path):
    allowed = {"DEVICE_API_KEY", "DEVICE_BACKEND_URL", "ESP32_API_KEY", "ESP32_URL"}
    values = {}
    if Path(path).exists():
        for line in Path(path).read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                if key.strip() in allowed:
                    values[key.strip()] = value.strip().strip("\"'")
    return {key: os.environ.get(key, values.get(key, "")) for key in allowed}


class Client:
    def __init__(self, base, key=""):
        parsed = parse.urlsplit(base)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Use an HTTP(S) URL without embedded credentials")
        self.base, self.key = base.rstrip("/"), key
        # These are fixed local endpoints. Never forward credentials via redirects/proxies.
        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def call(self, path, data=None):
        body = None if data is None else json.dumps(data, allow_nan=False).encode()
        headers = {"X-Device-Key": self.key, "Content-Type": "application/json"}
        req = request.Request(self.base + path, data=body, headers=headers,
                              method="GET" if data is None else "POST")
        with self.opener.open(req, timeout=2) as response:
            return json.load(response)


class GateSync:
    def __init__(self):
        self.version = None

    def reset(self):
        # Do not replay commands missed while disconnected.
        self.version = None

    def next_command(self, state, physical):
        b = state["barrier"]
        version = b["version"]
        if type(version) is not int or version < 0 or b["position"] not in ("OPEN", "CLOSED"):
            raise ValueError("Invalid backend barrier")
        previous, self.version = self.version, version
        if physical["fireAlarm"] or b["fireOverride"]:
            return "open" if physical["gate"] != "OPEN" else None
        if previous is None or version <= previous:
            return None
        if b["position"] == "OPEN":
            return "open" if physical["gate"] != "OPEN" else None
        events = state.get("events", [])
        if (physical["gate"] == "OPEN" and events
                and events[0]["kind"] in ("CLOSE", "PASSAGE")
                and events[0]["outcome"] in ("CANCELLED_CLOSE", "PASSAGE_CONFIRMED")):
            return "close"
        return None


def validate_status(status):
    if (status.get("gate") not in ("OPEN", "CLOSED")
            or status.get("slot") not in ("AVAILABLE", "OCCUPIED", "UNKNOWN")
            or type(status.get("fireAlarm")) is not bool
            or type(status.get("temperatureValid")) is not bool
            or type(status.get("sampleAgeMs")) is not int
            or not 0 <= status["sampleAgeMs"] < 2000):
        raise ValueError("Invalid or stale ESP32 status")
    temp = status.get("temperature")
    if status["temperatureValid"] and (type(temp) not in (int, float)
            or not math.isfinite(temp) or not -40 <= temp <= 150):
        raise ValueError("Invalid temperature")
    return status


def step(esp, backend, sync, slot_id):
    physical = validate_status(esp.call("/status"))
    # This firmware has one ultrasonic sensor. Never invent readings for other bays.
    backend.call("/api/device/status", {"deviceId": "esp8266-01", "spaces": [
        {"spaceId": slot_id, "status": physical["slot"]}]})
    if physical["temperatureValid"]:
        backend.call("/api/device/temperature", {
            "deviceId": "esp8266-01", "temperatureCelsius": round(physical["temperature"], 2)})
    desired = backend.call("/api/access/status")
    command = sync.next_command(desired, physical)
    if command:
        path = "/close?clear=true" if command == "close" else "/open"
        result = esp.call(path, {})
        if result.get("status") != "APPLIED" or result.get("gate") != ("OPEN" if command == "open" else "CLOSED"):
            raise ValueError("ESP32 did not acknowledge servo setpoint")
        physical["gate"] = result["gate"]
    return physical, command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(Path(__file__).resolve().parents[1] / ".env"))
    parser.add_argument("--slot", choices=["P01", "P02", "P03", "P04"], default="P01")
    parser.add_argument("--interval", type=float, default=1)
    args = parser.parse_args()
    if not .5 <= args.interval <= 5:
        parser.error("interval must be between 0.5 and 5 seconds")
    cfg = settings_file(args.env_file)
    if any(len(cfg[key]) < 24 or cfg[key].startswith(("replace", "REPLACE"))
           for key in ("DEVICE_API_KEY", "ESP32_API_KEY")):
        parser.error("Configure private DEVICE_API_KEY and ESP32_API_KEY (at least 24 characters)")
    esp = Client(cfg["ESP32_URL"] or "http://192.168.4.1", cfg["ESP32_API_KEY"])
    backend = Client(cfg["DEVICE_BACKEND_URL"] or "http://127.0.0.1:18080", cfg["DEVICE_API_KEY"])
    sync, last = GateSync(), None
    print("Hardware bridge active. New backend commands can move the servo. Confirm clear passage before CLOSE/PASSAGE.", flush=True)
    try:
        while True:
            started = time.monotonic()
            try:
                physical, command = step(esp, backend, sync, args.slot)
                state = (physical["gate"], physical["fireAlarm"], physical["temperatureValid"], physical["slot"])
                if state != last or command:
                    print(f"ESP32 setpoint={state[0]} fire={state[1]} temperature_valid={state[2]} slot={state[3]} command={command or 'none'}; no position feedback", flush=True)
                    last = state
            except Exception as exc:
                sync.reset()
                # Do not dump URLs, request bodies, response bodies or credentials.
                if last != "offline":
                    print(f"Bridge unavailable ({type(exc).__name__}); no fallback close. Commands will rearm after reconnection.", flush=True)
                last = "offline"
            time.sleep(max(.05, args.interval - (time.monotonic() - started)))
    except KeyboardInterrupt:
        print("Bridge stopped; no close command sent.")


if __name__ == "__main__":
    main()
