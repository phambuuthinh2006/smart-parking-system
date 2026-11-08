import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from esp32_bridge import Client, GateSync, step, validate_status


def physical():
    return dict(gate="CLOSED", slot="UNKNOWN", fireAlarm=False,
                temperatureValid=True, temperature=25, sampleAgeMs=12)


def desired(version=0, position="CLOSED", kind="DETECTION", outcome="ENTRY_PENDING"):
    return dict(barrier=dict(version=version, position=position, fireOverride=False),
                events=[dict(kind=kind, outcome=outcome)])


class SyncTests(unittest.TestCase):
    def test_no_replay_on_start_restart_or_reconnection(self):
        sync = GateSync()
        self.assertIsNone(sync.next_command(desired(8, "OPEN"), physical()))
        self.assertIsNone(sync.next_command(desired(8, "OPEN"), physical()))
        sync.reset()
        self.assertIsNone(sync.next_command(desired(9, "OPEN"), physical()))
        self.assertEqual(sync.next_command(desired(10, "OPEN"), physical()), "open")

    def test_close_requires_new_operator_event_never_cooling(self):
        sync = GateSync()
        p = physical(); p["gate"] = "OPEN"
        sync.next_command(desired(1, "OPEN"), p)
        self.assertIsNone(sync.next_command(desired(1), p))  # cooling, same version
        self.assertIsNone(sync.next_command(desired(2), p))  # no operator event
        self.assertEqual(sync.next_command(desired(3, kind="PASSAGE", outcome="PASSAGE_CONFIRMED"), p), "close")
        self.assertIsNone(sync.next_command(desired(3, kind="PASSAGE", outcome="PASSAGE_CONFIRMED"), p))

    def test_fire_dominates_close(self):
        sync = GateSync(); p = physical(); p["fireAlarm"] = True
        self.assertEqual(sync.next_command(desired(), p), "open")
        p["gate"] = "OPEN"
        self.assertIsNone(sync.next_command(desired(1, kind="CLOSE", outcome="CANCELLED_CLOSE"), p))

    def test_faults_and_stale_status(self):
        p = physical(); p.update(temperature=None, temperatureValid=False)
        self.assertEqual(validate_status(p), p)
        for key, value in (("sampleAgeMs", 2000), ("temperature", float("nan")),
                           ("slot", "EMPTY"), ("gate", "garbage")):
            p = physical(); p[key] = value
            with self.assertRaises(ValueError): validate_status(p)

    def test_real_http_camera_request_to_servo_and_sensor_adapter(self):
        calls, gate = [], physical()
        state = desired()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def respond(self, payload):
                self.send_response(200); self.send_header("Content-Type", "application/json")
                self.end_headers(); self.wfile.write(json.dumps(payload).encode())
            def do_GET(self):
                calls.append((self.path, self.headers.get("X-Device-Key"), None))
                self.respond(gate if self.path == "/status" else state)
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append((self.path, self.headers.get("X-Device-Key"), body))
                if self.path.startswith(("/open", "/close")):
                    gate["gate"] = "OPEN" if self.path == "/open" else "CLOSED"
                    self.respond(dict(status="APPLIED", gate=gate["gate"]))
                else: self.respond({})
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}"
            esp, backend = Client(url, "esp-test-key"), Client(url, "backend-test-key")
            sync = GateSync()
            step(esp, backend, sync, "P01")
            state.update(desired(1, "OPEN"))  # committed camera detection opens requested barrier
            self.assertEqual(step(esp, backend, sync, "P01")[1], "open")
            self.assertEqual(gate["gate"], "OPEN")
            state.update(desired(2, kind="PASSAGE", outcome="PASSAGE_CONFIRMED"))
            acknowledged, command = step(esp, backend, sync, "P01")
            self.assertEqual(command, "close")
            self.assertEqual(acknowledged["gate"], "CLOSED")
            self.assertEqual(gate["gate"], "CLOSED")
            self.assertIn(("/close?clear=true", "esp-test-key", {}), calls)
            reports = [body for path, key, body in calls if path == "/api/device/status"]
            self.assertEqual(reports[0]["spaces"], [{"spaceId": "P01", "status": "UNKNOWN"}])
            self.assertTrue(all(key == "backend-test-key" for path, key, _ in calls if path.startswith("/api")))
            gate.update(temperature=None, temperatureValid=False)
            count = sum(path == "/api/device/temperature" for path, _, _ in calls)
            step(esp, backend, sync, "P01")
            self.assertEqual(sum(path == "/api/device/temperature" for path, _, _ in calls), count)
        finally:
            server.shutdown(); thread.join(); server.server_close()


if __name__ == "__main__": unittest.main()
