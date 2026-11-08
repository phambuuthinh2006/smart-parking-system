import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from web_link import HttpLink, PlateUploader
from gate_link import GatePlan, send_command


class WebLinkTests(unittest.TestCase):
    def test_original_ocr_text_sent_over_http(self):
        seen = []
        received = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                raw = self.rfile.read(int(self.headers['Content-Length']))
                seen.append((self.path, self.headers.get('X-Device-Key'), json.loads(raw) if raw else {}))
                self.send_response(200); self.end_headers()
                self.wfile.write(b'{"outcome":"NOT_REGISTERED"}' if self.path.startswith('/api/') else b'{"status":"COMMAND_RECEIVED"}')
                received.set()
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with patch('web_link.settings', return_value={'DEVICE_API_KEY':'test-key-not-a-secret-123456', 'DEVICE_BACKEND_URL':f'http://127.0.0.1:{server.server_port}'}):
                uploader = PlateUploader(HttpLink())
            try:
                uploader.submit('43A-123.45')
                self.assertTrue(received.wait(3))
                uploader.submit('43A-123.45')
                self.assertEqual(len(seen), 1)
                path, key, body = seen[0]
                self.assertEqual(path, '/api/device/plate-readings')
                self.assertEqual(body['plateText'], '43A-123.45')
                self.assertEqual(body['direction'], 'ENTRY')
                self.assertNotIn('confidence', body)
                self.assertNotIn(key, json.dumps(body))
                url = f'http://127.0.0.1:{server.server_port}'
                self.assertEqual(send_command(uploader.link.opener, url, '', 'open')['status'], 'COMMAND_RECEIVED')
                self.assertEqual(send_command(uploader.link.opener, url, '', 'close')['status'], 'COMMAND_RECEIVED')
                self.assertEqual([item[0] for item in seen[1:]], ['/open', '/close?clear=true'])
            finally: uploader.close()
        finally: server.shutdown(); thread.join(); server.server_close()

    def test_no_gate_replay_or_timer_close(self):
        p = GatePlan()
        def state(version, position='CLOSED', kind='DETECTION', outcome='NOT_REGISTERED'):
            return {'barrier': {'version': version, 'position': position, 'fireOverride': False},
                    'events': [{'kind':kind, 'outcome':outcome}]}
        self.assertIsNone(p.next(state(3, 'OPEN')))
        self.assertIsNone(p.next(state(3, 'OPEN')))
        self.assertEqual(p.next(state(4, 'OPEN', outcome='ENTRY_PENDING')), 'open')
        self.assertIsNone(p.next(state(4)))  # no timer or cooling-based close
        self.assertEqual(p.next(state(5, kind='PASSAGE', outcome='PASSAGE_CONFIRMED')), 'close')
        p.reset()
        self.assertIsNone(p.next(state(6, kind='CLOSE', outcome='CANCELLED_CLOSE')))

    def test_fire_open_is_once_and_never_close(self):
        p = GatePlan()
        state = {'barrier': {'version': 0, 'position':'OPEN', 'fireOverride':True}, 'events':[]}
        self.assertEqual(p.next(state), 'open')
        p.fire_sent = True  # acknowledgement from HTTP
        self.assertIsNone(p.next(state))
        state['barrier']['fireOverride'] = False
        state['barrier']['position'] = 'CLOSED'
        self.assertIsNone(p.next(state))


if __name__ == '__main__': unittest.main()
