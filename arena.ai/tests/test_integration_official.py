#!/usr/bin/env python3
"""Integration test against the OFFICIAL OoklaServer daemon.

The test is skipped unless a laboratory daemon is reachable.  Start one with:

    sh lab/scripts/start-daemon.sh https

and point the test at it:

    OKLA_LAB_HOST=127.0.0.1 OKLA_LAB_PORT=8080 \\
    OKLA_LAB_CA=lab/certs/ca.crt python3 tests/test_integration_official.py

This is the only test that asserts behaviour of the genuine official binary;
everything else uses a local test double.
"""
import os
import socket
import ssl
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import app  # noqa: E402

HOST = os.environ.get("OKLA_LAB_HOST", "127.0.0.1")
PORT = int(os.environ.get("OKLA_LAB_PORT", "8080"))
CA = os.environ.get("OKLA_LAB_CA", os.path.join(os.path.dirname(HERE), "lab", "certs", "ca.crt"))


def daemon_reachable():
    try:
        with socket.create_connection((HOST, PORT), timeout=2):
            return True
    except OSError:
        return False


@unittest.skipUnless(daemon_reachable(),
                     f"no official OoklaServer daemon on {HOST}:{PORT}")
class TestOfficialDaemon(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ca = CA if os.path.isfile(CA) else None

    def run_tests(self, **kw):
        opts = dict(allow_private=True, legacy_port=PORT, upload_mode="auto",
                    ca_bundle=self.ca)
        opts.update(kw)
        return app.run_all_tests(f"{HOST}:{PORT}", **opts)

    @staticmethod
    def status_of(data, key):
        for section in data["sections"]:
            for row in section["rows"]:
                if row["key"] == key:
                    return row["status"]
        return None

    def test_netgauge_handshake(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "netgauge"), "PASSED")

    def test_websocket_upgrade(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "websocket"), "PASSED")

    def test_crossdomain(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "crossdomain"), "PASSED")

    def test_https_is_verified(self):
        data = self.run_tests()
        self.assertEqual(self.status_of(data, "https"), "PASSED")
        details = [r["details"] for s in data["sections"] for r in s["rows"]
                   if r["key"] == "https"][0]
        self.assertIn("verified", details)

    def test_legacy_endpoints_served_by_the_daemon(self):
        data = self.run_tests()
        for key in ("latency", "upload", "max_upload", "image_sizes", "keepalive"):
            self.assertEqual(self.status_of(data, key), "PASSED", key)

    def test_all_nineteen_checks_pass(self):
        data = self.run_tests()
        self.assertEqual(data["summary"]["total"], 19)
        self.assertEqual(data["summary"]["failed"], 0)

    def test_upload_uses_the_native_daemon_algorithm(self):
        data = self.run_tests()
        details = [r["details"] for s in data["sections"] for r in s["rows"]
                   if r["key"] == "upload"][0]
        self.assertIn("detected_mode : native-daemon", details)

    def test_legacy_upload_mode_must_fail_against_the_daemon(self):
        """Negative control: the daemon speaks the native algorithm."""
        data = self.run_tests(upload_mode="legacy")
        self.assertEqual(self.status_of(data, "upload"), "FAILED")
        self.assertEqual(self.status_of(data, "max_upload"), "FAILED")

    def test_tls_transport_variant(self):
        data = self.run_tests(daemon_tls=True)
        self.assertEqual(self.status_of(data, "netgauge"), "PASSED")
        self.assertEqual(self.status_of(data, "websocket"), "PASSED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
