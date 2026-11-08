"""Forward new web gate requests to SmartParking; never infer vehicle passage."""
import argparse
import time
from web_link import HttpLink
from urllib import request
import json


class GatePlan:
    def __init__(self): self.version, self.fire_sent = None, False
    def reset(self): self.version, self.fire_sent = None, False
    def next(self, state):
        gate = state["barrier"]
        version = gate["version"]
        if type(version) is not int or version < 0: raise ValueError("Invalid barrier version")
        previous, self.version = self.version, version
        fire = bool(gate["fireOverride"])
        if fire: return "open" if not getattr(self, "fire_sent", False) else None
        self.fire_sent = False
        if previous is None or version <= previous: return None
        if gate["position"] == "OPEN": return "open"
        events = state.get("events", [])
        if events and events[0]["kind"] in ("PASSAGE", "CLOSE") and events[0]["outcome"] in ("PASSAGE_CONFIRMED", "CANCELLED_CLOSE"):
            return "close"
        return None



def send_command(opener, esp_url, key, command):
    path = "/close?clear=true" if command == "close" else "/open"
    req = request.Request(esp_url.rstrip("/") + path, data=b"", method="POST", headers={"X-Device-Key": key})
    with opener.open(req, timeout=2) as response: result = json.load(response)
    if result.get("status") not in ("APPLIED", "COMMAND_RECEIVED"):
        raise ValueError("ESP32 acknowledgement missing")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--esp-url", default="http://192.168.4.1")
    args = parser.parse_args()
    backend = HttpLink()
    # This optional key supports the updated root firmware too; original Project firmware ignores it.
    import os
    from pathlib import Path
    key = os.environ.get("ESP32_API_KEY", "")
    if not key:
        env = Path(__file__).resolve().parents[2] / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("ESP32_API_KEY="): key = line.split("=", 1)[1].strip().strip("\"'")
    plan = GatePlan()
    print("Gate link active: new web requests may move the servo. Close only after operator confirms passage is clear.", flush=True)
    try:
        while True:
            try:
                state = backend.call("/api/access/status")
                command = plan.next(state)
                if command:
                    result = send_command(backend.opener, args.esp_url, key, command)
                    plan.fire_sent = bool(state["barrier"]["fireOverride"])
                    print("ESP32:", command, result["status"], "(no position feedback)", flush=True)
            except Exception as exc:
                plan.reset()
                print(f"Gate link unavailable ({type(exc).__name__}); no fallback close or replay.", flush=True)
                time.sleep(2)
            time.sleep(.5)
    except KeyboardInterrupt: print("Gate link stopped; no close command sent.")


if __name__ == "__main__": main()
