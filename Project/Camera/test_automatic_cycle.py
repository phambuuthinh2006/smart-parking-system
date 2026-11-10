import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from gate_link import AutomaticCycle, GatePlan, GateLinkRunner, read_hardware, send_esp_command
from web_link import HttpLink, CameraEncounter


def state(version, pending=False):
    return {"barrier": {"version": version, "position": "OPEN" if pending else "CLOSED",
            "pendingVisitId": 5 if pending else None, "requestId": "11111111-2222-3333-8444-555555555555" if pending else None,
            "fireOverride": False}, "events": []}


class AutomaticCycleTests(unittest.TestCase):
    def test_encounter_only_changes_after_observed_empty_frames_not_ocr_noise(self):
        encounter = CameraEncounter()
        first = encounter.observe(True, 0)
        self.assertEqual(encounter.observe(True, 100), first)
        encounter.observe(False, 101)
        self.assertEqual(encounter.observe(True, 102), first)
        encounter.observe(False, 103)
        encounter.observe(False, 105.1)
        second = encounter.observe(True, 106)
        self.assertNotEqual(first, second)
        self.assertEqual(encounter.observe(True, 500), second)

    def test_startup_never_replays_but_new_command_retries_same_id_and_stops_after_ack(self):
        plan, auto = GatePlan(), AutomaticCycle()
        s = state(1, True)
        self.assertIsNone(plan.next(s))
        self.assertIsNone(auto.opening(s, {}, None, 0))
        s = state(2, True)
        token = auto.opening(s, {}, plan.next(s), 1)
        self.assertEqual(token, s['barrier']['requestId'])
        self.assertEqual(auto.opening(s, {}, None, 2), token)
        self.assertIsNone(auto.opening(s, {"requestId": token, "phase": "PASSED"}, None, 3))
        self.assertIsNone(auto.opening(s, {}, None, 4))

    def test_expired_or_changed_request_does_not_retry(self):
        for change in (state(3), state(2, True)):
            auto = AutomaticCycle()
            auto.opening(state(2, True), {}, 'open', 0)
            self.assertIsNone(auto.opening(change, {}, None, 31))

    def test_feedback_uses_hardware_token_not_assumed_backend_state(self):
        packet = AutomaticCycle().feedback(state(2, True), {
            'requestId': 'old-cycle', 'phase': 'BLOCKED', 'gate': 'OPEN', 'sampleAgeMs': 10, 'slot': 'AVAILABLE', 'slotSensorValid': True, 'gatePresent': True, 'gateSensorValid': True})
        self.assertEqual(packet['requestId'], 'old-cycle')
        self.assertEqual(packet['phase'], 'BLOCKED')
        self.assertEqual(packet['expectedVersion'], 2)

    def test_http_bridge_dispatches_correlated_open_and_reports_completion(self):
        reached, completed = threading.Event(), threading.Event()
        backend_state = state(0)
        physical = {'protocolVersion': 3, 'telemetryValid': True, 'sampleAgeMs': 10,
                    'gate': 'CLOSED', 'phase': 'IDLE', 'requestId': '', 'slot': 'AVAILABLE', 'slotSensorValid': True, 'gatePresent': True, 'gateSensorValid': True}
        commands, feedback = [], []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def reply(self, obj):
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps(obj).encode())
            def do_GET(self):
                if self.path == '/api/access/status': self.reply(backend_state)
                else: self.reply(physical)
            def do_POST(self):
                if self.path.startswith('/open?'):
                    from urllib.parse import parse_qs, urlsplit
                    token = parse_qs(urlsplit(self.path).query)['requestId'][0]
                    commands.append(token)
                    physical.update(requestId=token, gate='OPEN', phase='OPEN')
                    self.reply({'status': 'COMMAND_RECEIVED', 'requestId': token})
                    reached.set()
                else:
                    packet = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                    feedback.append(packet)
                    outcome = 'HARDWARE_UPDATED'
                    if packet['phase'] == 'PASSED':
                        backend_state.update(state(2))
                        outcome = 'AUTO_PASSAGE_CONFIRMED'
                        completed.set()
                    self.reply({'outcome': outcome, 'snapshot': {'access': backend_state}})

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        with patch('web_link.load_settings', return_value={'DEVICE_BACKEND_URL': base}):
            backend = HttpLink()
        with patch('gate_link.load_settings', return_value={}):
            runner = GateLinkRunner(base, backend)
        try:
            runner.start()
            # Wait for the startup baseline, then introduce a NEW camera request.
            for _ in range(100):
                if runner.plan.version == 0: break
                threading.Event().wait(.02)
            self.assertEqual(runner.plan.version, 0)
            backend_state.update(state(1, True))
            self.assertTrue(reached.wait(5))
            physical.update(gate='CLOSED', phase='PASSED')
            self.assertTrue(completed.wait(5))
            self.assertEqual(len(commands), 1)
            self.assertEqual(feedback[-1]['requestId'], commands[0])
            self.assertEqual(feedback[-1]['visitId'], 5)
        finally:
            runner.stop(); server.shutdown(); thread.join(); server.server_close()

    def test_legacy_or_stale_telemetry_is_rejected(self):
        class Reply:
            def __init__(self, obj): self.obj = obj
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return json.dumps(self.obj).encode()
        for packet in ({'gate': 'CLOSED'}, {'protocolVersion': 2, 'telemetryValid': False, 'sampleAgeMs': 9999}):
            with patch('urllib.request.OpenerDirector.open', return_value=Reply(packet)):
                from urllib.request import build_opener
                with self.assertRaises(ValueError): read_hardware(build_opener(), 'http://localhost')


if __name__ == '__main__': unittest.main()
