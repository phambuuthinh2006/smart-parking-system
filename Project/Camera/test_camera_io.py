import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from camera_io import open_camera
from web_link import HttpLink, describe_http_error


class Frame:
    size = 1


class Capture:
    def __init__(self, opened, reads):
        self.opened = opened
        self.reads = iter(reads)
        self.released = False
    def isOpened(self): return self.opened
    def read(self): return next(self.reads, (False, None))
    def release(self): self.released = True


class FakeCV:
    CAP_DSHOW, CAP_MSMF, CAP_ANY = 700, 1400, 0
    def __init__(self, caps):
        self.caps = iter(caps)
        self.calls = []
    def VideoCapture(self, source, api):
        self.calls.append((source, api))
        return next(self.caps)


class CameraIOTests(unittest.TestCase):
    def test_windows_auto_prefers_directshow_and_requires_a_real_frame(self):
        cap = Capture(True, [(False, None), (True, Frame())])
        cv = FakeCV([cap])
        with patch('camera_io.time.sleep'):
            result, frame, name = open_camera(1, cv=cv, platform_name='win32')
        self.assertIs(result, cap)
        self.assertEqual(name, 'dshow')
        self.assertEqual(cv.calls, [(1, 700)])
        self.assertFalse(cap.released)

    def test_fallback_releases_failed_capture_without_switching_device(self):
        first, second = Capture(True, []), Capture(True, [(True, Frame())])
        cv = FakeCV([first, second])
        with patch('camera_io.time.sleep'):
            cap, _, name = open_camera(1, cv=cv, platform_name='win32')
        self.assertEqual(name, 'msmf')
        self.assertTrue(first.released)
        self.assertFalse(second.released)
        self.assertEqual(cv.calls, [(1, 700), (1, 1400)])

    def test_failed_explicit_device_is_closed_and_not_reported_ready(self):
        cap = Capture(False, [])
        cv = FakeCV([cap])
        with self.assertRaisesRegex(ValueError, 'cannot read frames'):
            open_camera(1, 'dshow', cv=cv, platform_name='win32')
        self.assertTrue(cap.released)
        self.assertEqual(cv.calls, [(1, 700)])

    def test_linux_device_path_keeps_native_backend(self):
        cv = FakeCV([Capture(True, [(True, Frame())])])
        open_camera('/dev/video2', cv=cv, platform_name='linux')
        self.assertEqual(cv.calls, [('/dev/video2', 0)])

    def test_preflight_rejects_main_backend_and_old_direction(self):
        with patch('web_link.load_settings', return_value={'PARKING_DIRECTION': 'AUTO'}):
            link = HttpLink()
        with patch.object(link, 'call', return_value={'stats': {'capacity': 4}}):
            with self.assertRaisesRegex(ValueError, '18081'): link.verify_experiment()
        state = {'stats': {'capacity': 1, 'pendingParking': 0}}
        with patch.object(link, 'call', return_value=state):
            self.assertIs(link.verify_experiment(), state)
            link.direction = 'ENTRY'
            with self.assertRaisesRegex(ValueError, 'AUTO'): link.verify_experiment()

    def test_http_diagnostics_print_status_without_url_or_secret(self):
        text = describe_http_error(HTTPError('http://private/key-secret', 401, 'secret-body', None, None))
        self.assertIn('401', text)
        self.assertNotIn('secret', text)
        self.assertNotIn('private', text)


if __name__ == '__main__': unittest.main()
