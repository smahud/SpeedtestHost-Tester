#!/usr/bin/env python3
"""Protocol level regression tests.

Each test drives the real client code against a controllable fake daemon, so
both the positive and the negative behaviour of every check is pinned down.
"""
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import app            # noqa: E402
import fake_ookla     # noqa: E402

# A small image set keeps the suite fast; the byte sizes are the official
# ones, only the number of files is reduced.
TEST_IMAGE_SIZES = [(350, 245388), (500, 505544)]
# 9 top level checks + one sub row per image file.
EXPECTED_TOTAL = 9 + len(TEST_IMAGE_SIZES)


class FakeDaemonTestCase(unittest.TestCase):
    """Base class that starts a fake daemon for every test."""

    def config(self):
        """Return the FakeConfig for this test.  Override in subclasses."""
        return fake_ookla.FakeConfig(
            image_sizes={dim: size for dim, size in TEST_IMAGE_SIZES},
        )

    def setUp(self):
        self._orig_sizes = app.IMAGE_SIZES
        app.IMAGE_SIZES = TEST_IMAGE_SIZES
        self.server, self.thread = fake_ookla.start(self.config())
        self.host = "127.0.0.1"
        self.port = self.server.port

    def tearDown(self):
        fake_ookla.stop(self.server)
        app.IMAGE_SIZES = self._orig_sizes

    def run_tests(self, **kw):
        opts = dict(allow_private=True, legacy_port=self.port, upload_mode="auto")
        opts.update(kw)
        return app.run_all_tests(f"{self.host}:{self.port}", **opts)

    @staticmethod
    def status_of(data, key):
        for section in data["sections"]:
            for row in section["rows"]:
                if row["key"] == key:
                    return row["status"]
        return None

    @staticmethod
    def details_of(data, key):
        for section in data["sections"]:
            for row in section["rows"]:
                if row["key"] == key:
                    return row["details"]
        return ""


class TestNetGauge(FakeDaemonTestCase):
    def test_valid_handshake_passes(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "netgauge"), "PASSED")
        self.assertIn("transport : plain TCP", self.details_of(data, "netgauge"))

    def test_wrong_handshake_fails(self):
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.netgauge_reply = "NOPE 1.0"
            return base
        self.tearDown()
        self.setUp = lambda: None
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "netgauge"), "FAILED")


class TestWebSocket(FakeDaemonTestCase):
    def test_valid_upgrade_passes(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "websocket"), "PASSED")

    def test_bad_accept_header_fails(self):
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.ws_accept_ok = False
            return base
        self.tearDown()
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "websocket"), "FAILED")

    def test_wrong_hello_frame_fails(self):
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.ws_hello = "BYE"
            return base
        self.tearDown()
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "websocket"), "FAILED")


class TestCrossDomain(FakeDaemonTestCase):
    def test_wildcard_domain_passes(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "crossdomain"), "PASSED")

    def test_missing_required_domain_fails(self):
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.crossdomain = ('<?xml version="1.0"?>\n<cross-domain-policy>\n'
                                '<allow-access-from domain="*.example.com" to-ports="*"/>\n'
                                '</cross-domain-policy>\n')
            return base
        self.tearDown()
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "crossdomain"), "FAILED")

    def test_port_not_listed_fails(self):
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.crossdomain = ('<?xml version="1.0"?>\n<cross-domain-policy>\n'
                                '<allow-access-from domain="*" to-ports="1-100"/>\n'
                                '</cross-domain-policy>\n')
            return base
        self.tearDown()
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "crossdomain"), "FAILED")


class TestLegacyFallback(FakeDaemonTestCase):
    def test_legacy_php_upload_mode(self):
        data = self.run_tests(upload_mode="legacy")
        self.assertEqual(self.status_of(data, "upload"), "PASSED")
        self.assertEqual(self.status_of(data, "max_upload"), "PASSED")

    def test_native_daemon_upload_mode(self):
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.upload_mode = "native"
            return base
        self.tearDown()
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests(upload_mode="native")
        self.assertEqual(self.status_of(data, "upload"), "PASSED")
        self.assertEqual(self.status_of(data, "max_upload"), "PASSED")

    def test_upload_mode_mismatch_is_reported(self):
        """A daemon that speaks the other algorithm must not silently pass."""
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.upload_mode = "native"
            return base
        self.tearDown()
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests(upload_mode="legacy")
        self.assertEqual(self.status_of(data, "upload"), "FAILED")
        self.assertEqual(self.status_of(data, "max_upload"), "FAILED")

    def test_auto_mode_detects_which_algorithm(self):
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.upload_mode = "native"
            return base
        self.tearDown()
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests(upload_mode="auto")
        self.assertEqual(self.status_of(data, "upload"), "PASSED")
        self.assertIn("detected_mode : native-daemon", self.details_of(data, "upload"))

    def test_latency_body_must_match(self):
        def cfg():
            base = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES})
            base.latency_body = "nope"
            return base
        self.tearDown()
        self.server, self.thread = fake_ookla.start(cfg())
        self.port = self.server.port
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "latency"), "FAILED")

    def test_image_sizes(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "image_sizes"), "PASSED")

    def test_keepalive(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "keepalive"), "PASSED")


class TestMalformedServer(FakeDaemonTestCase):
    def _restart(self, **kw):
        self.tearDown()
        cfg = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES}, **kw)
        self.server, self.thread = fake_ookla.start(cfg)
        self.port = self.server.port

    def _http_keys_failed(self, data):
        """Every check that needs an HTTP response must be FAILED."""
        http_keys = ("crossdomain", "latency", "upload", "max_upload", "image_sizes")
        return all(self.status_of(data, k) == "FAILED" for k in http_keys)

    def test_garbage_http_response_fails_cleanly(self):
        self._restart(http_mode="garbage")
        data = self.run_tests()
        self.assertTrue(self._http_keys_failed(data), data)
        self.assertEqual(self.status_of(data, "netgauge"), "PASSED")

    def test_truncated_body_fails_cleanly(self):
        self._restart(http_mode="truncate")
        data = self.run_tests()
        self.assertTrue(self._http_keys_failed(data), data)

    def test_connection_reset_fails_cleanly(self):
        self._restart(http_mode="reset")
        data = self.run_tests()
        self.assertTrue(self._http_keys_failed(data), data)

    def test_websocket_upgrade_rejected(self):
        self._restart(http_mode="garbage")
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "websocket"), "FAILED")


class TestSummaryAccounting(FakeDaemonTestCase):
    def test_every_check_is_reported(self):
        data = self.run_tests()
        self.assertEqual(data["summary"]["total"], EXPECTED_TOTAL)

    def test_counts_add_up(self):
        data = self.run_tests()
        s = data["summary"]
        self.assertEqual(s["passed"] + s["failed"], s["total"])

    def test_result_contains_every_documented_key(self):
        data = self.run_tests()
        for key in ("input", "normalized_input", "host", "port", "timestamp", "resolved",
                    "options", "sections", "summary", "allow_private", "input_scheme"):
            self.assertIn(key, data)
        self.assertEqual(len(data["sections"]), 2)


class TestDeadline(FakeDaemonTestCase):
    def test_global_deadline_bounds_a_slow_server(self):
        """A server that never answers must not make the run hang."""
        self.tearDown()
        cfg = fake_ookla.FakeConfig(image_sizes={d: s for d, s in TEST_IMAGE_SIZES}, delay=5.0)
        self.server, self.thread = fake_ookla.start(cfg)
        self.port = self.server.port
        started = time.monotonic()
        data = self.run_tests(timeout=2.0)
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 20.0, "the global deadline was not enforced")
        self.assertEqual(data["options"]["timeout"], 2.0)

    def test_invalid_timeout_rejected(self):
        with self.assertRaises(ValueError):
            self.run_tests(timeout=0)


class TestSchemeSelectsTransport(FakeDaemonTestCase):
    def test_https_input_uses_tls_transport(self):
        data = app.run_all_tests(f"https://{self.host}:{self.port}",
                                 allow_private=True, legacy_port=self.port)
        self.assertTrue(data["options"]["daemon_tls"])
        self.assertEqual(data["options"]["daemon_tls_source"], "auto (https:// input)")

    def test_plain_input_uses_tcp_transport(self):
        data = app.run_all_tests(f"{self.host}:{self.port}",
                                 allow_private=True, legacy_port=self.port)
        self.assertFalse(data["options"]["daemon_tls"])

    def test_explicit_override_wins(self):
        data = app.run_all_tests(f"https://{self.host}:{self.port}",
                                 allow_private=True, legacy_port=self.port, daemon_tls=False)
        self.assertFalse(data["options"]["daemon_tls"])
        self.assertEqual(data["options"]["daemon_tls_source"], "explicit")


if __name__ == "__main__":
    unittest.main(verbosity=2)
