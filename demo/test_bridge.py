import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from bridge import StablePlate, make_event, valid_plate, read_ocr_rows, post_event


class BridgeTests(unittest.TestCase):
    def test_consensus_absence_and_cooldown(self):
        s = StablePlate(3, 10, 2)
        self.assertIsNone(s.observe('43A12345', 0))
        self.assertIsNone(s.observe('43A12345', .1))
        self.assertEqual(s.observe('43A12345', .2), '43A12345')
        self.assertIsNone(s.observe('43A12345', .3))
        s.observe(None, 3)
        for at in (11, 11.1):
            self.assertIsNone(s.observe('43A12345', at))
        self.assertEqual(s.observe('43A12345', 11.2), '43A12345')

    def test_rows_and_validation(self):
        results = [([[20,30],[60,30],[60,40],[20,40]], '123.45', .95),
                   ([[10,0],[60,0],[60,10],[10,10]], '43A', .98)]
        self.assertEqual(read_ocr_rows(results), ('43A12345', .95))
        self.assertTrue(valid_plate('43A-123.45'))
        self.assertFalse(valid_plate('car'))
        self.assertRaises(ValueError, make_event, 'car', 'ENTRY', 1, 'gate')

    def test_network_retries_keep_payload_and_key_out_of_body(self):
        event = make_event('43A12345', 'ENTRY', .9, 'gate')
        seen = []
        def offline(req, **kwargs):
            seen.append(req.data)
            raise URLError('offline')
        with patch('bridge.request.urlopen', offline):
            self.assertRaises(RuntimeError, post_event, 'http://localhost', 'not-a-real-key', event, 3, lambda _: None)
        self.assertEqual(len(seen), 3)
        self.assertTrue(all(body == seen[0] for body in seen))
        self.assertNotIn(b'not-a-real-key', seen[0])

    def test_auth_failure_is_not_retried(self):
        with patch('bridge.request.urlopen', side_effect=HTTPError('url', 401, '', {}, None)) as sender:
            self.assertRaises(RuntimeError, post_event, 'http://localhost', 'fake', make_event('43A12345','ENTRY',1,'gate'))
        self.assertEqual(sender.call_count, 1)


if __name__ == '__main__':
    unittest.main()
