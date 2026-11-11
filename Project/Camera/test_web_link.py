import json
import threading
import unittest
import tempfile
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from web_link import HttpLink, PlateUploader, load_settings
from gate_link import GatePlan, send_esp_command


class WebLinkTests(unittest.TestCase):
    def test_camera_env_overrides_root_and_environment_overrides_both(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            camera = root / 'Project' / 'Camera'
            camera.mkdir(parents=True)
            (root / '.env').write_text('DEVICE_BACKEND_URL=http://127.0.0.1:18080\nDEVICE_API_KEY=root-test-key\n')
            (camera / '.env').write_text('\ufeffDEVICE_BACKEND_URL=http://192.168.4.2:18080\nDEVICE_API_KEY=camera-test-key\n', encoding='utf-8')
            with patch('web_link.__file__', str(camera / 'web_link.py')), patch.dict('os.environ', {}, clear=True):
                self.assertEqual(load_settings()['DEVICE_BACKEND_URL'], 'http://192.168.4.2:18080')
                self.assertEqual(load_settings()['DEVICE_API_KEY'], 'camera-test-key')
                with patch.dict('os.environ', {'DEVICE_BACKEND_URL': 'http://192.168.4.3:18080'}):
                    self.assertEqual(load_settings()['DEVICE_BACKEND_URL'], 'http://192.168.4.3:18080')
                (camera / '.env').unlink()
                self.assertEqual(load_settings()['DEVICE_API_KEY'], 'root-test-key')

    def test_original_ocr_text_sent_over_http(self):
        seen = []
        received = threading.Event()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                raw = self.rfile.read(int(self.headers['Content-Length'])) if 'Content-Length' in self.headers else b""
                seen.append((self.path, self.headers.get('X-Device-Key'), json.loads(raw) if raw else {}))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"outcome":"NOT_REGISTERED"}' if self.path.startswith('/api/') else b'{"status":"COMMAND_RECEIVED"}')
                received.set()

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch('web_link.load_settings', return_value={'DEVICE_API_KEY': 'test-key-not-a-secret-123456', 'DEVICE_BACKEND_URL': f'http://127.0.0.1:{server.server_port}'}):
                uploader = PlateUploader(HttpLink())
            try:
                uploader.submit('43A-123.45')
                self.assertTrue(received.wait(3))
                uploader.submit('43A-123.45')
                self.assertEqual(len(seen), 1)
                path, key, body = seen[0]
                self.assertEqual(path, '/api/device/plate-readings')
                self.assertEqual(body['plateText'], '43A-123.45')
                self.assertEqual(body['direction'], 'AUTO')
                self.assertNotIn('confidence', body)
                self.assertNotIn(key, json.dumps(body))

                url = f'http://127.0.0.1:{server.server_port}'
                self.assertEqual(send_esp_command(uploader.link.opener, url, 'open', '')['status'], 'COMMAND_RECEIVED')
                self.assertEqual(send_esp_command(uploader.link.opener, url, 'close', '')['status'], 'COMMAND_RECEIVED')
                self.assertEqual([item[0] for item in seen[1:]], ['/open', '/close'])
            finally:
                uploader.close()
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_no_gate_replay_or_timer_close(self):
        p = GatePlan()

        def state(version, position='CLOSED', kind='DETECTION', outcome='NOT_REGISTERED'):
            return {
                'barrier': {'version': version, 'position': position, 'fireOverride': False},
                'events': [{'kind': kind, 'outcome': outcome}]
            }

        self.assertIsNone(p.next(state(3, 'OPEN')))
        self.assertIsNone(p.next(state(3, 'OPEN')))
        self.assertEqual(p.next(state(4, 'OPEN', outcome='ENTRY_PENDING')), 'open')
        self.assertIsNone(p.next(state(4)))
        self.assertEqual(p.next(state(5, kind='PASSAGE', outcome='PASSAGE_CONFIRMED')), 'close')
        p.reset()
        self.assertIsNone(p.next(state(6, kind='CLOSE', outcome='CANCELLED_CLOSE')))

    def test_fire_open_is_once_and_never_close(self):
        p = GatePlan()
        state = {'barrier': {'version': 0, 'position': 'OPEN', 'fireOverride': True}, 'events': []}
        self.assertEqual(p.next(state), 'open')
        p.fire_sent = True
        self.assertIsNone(p.next(state))
        state['barrier']['fireOverride'] = False
        state['barrier']['position'] = 'CLOSED'
        self.assertIsNone(p.next(state))


    def test_encounter_lock_and_format_filter(self):
        class DummyLink:
            direction = "AUTO"
            def call(self, path, body=None):
                return {"outcome": "ENTRY_PENDING", "plate": "36H-123.45"}

        uploader = PlateUploader(DummyLink())
        try:
            # 1. Invalid formats should be ignored
            uploader.submit("INVALID_PLATE")
            uploader.submit("123")
            uploader.submit("ABCDE")
            self.assertTrue(uploader.pending.empty())

            # 2. Valid plate should be accepted and processed
            uploader.submit("36H-123.45")
            # Wait for thread to process and lock encounter
            import time
            for _ in range(50):
                if uploader.encounter_locked:
                    break
                time.sleep(0.05)
            self.assertTrue(uploader.encounter_locked)

            # 3. Subsequent submit while locked should be ignored
            uploader.submit("36H-999.99")
            self.assertTrue(uploader.pending.empty())

            # 4. Simulate car leaves (empty frame for >= 2s) and new car arrives
            t0 = time.monotonic()
            uploader.encounter.observe(False, t0)
            uploader.encounter.observe(False, t0 + 2.5)
            self.assertTrue(uploader.encounter.cleared)
            uploader.encounter.observe(True, t0 + 3.0)

            # Encounter should now be unlocked!
            self.assertFalse(uploader.encounter_locked)
        finally:
            uploader.close()


if __name__ == '__main__':
    unittest.main()

