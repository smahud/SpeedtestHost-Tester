#!/usr/bin/env python3
"""Input normalisation, target validation and address policy tests.

Regression target: the input parser must accept exactly the documented
formats, must never accept an ambiguous or dangerous target, and must apply
the private-network policy to the *resolved* addresses (not only to the
"is there at least one public address" question).
"""
import os
import socket
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402


class TestNormalizeTarget(unittest.TestCase):
    def test_host_port_unchanged(self):
        self.assertEqual(app.normalize_target("host.example.com:8080")[0], "host.example.com:8080")
        self.assertIsNone(app.normalize_target("host.example.com:8080")[1])

    def test_bare_host_gets_default_port(self):
        target, note = app.normalize_target("host.example.com")
        self.assertEqual(target, "host.example.com:8080")
        self.assertIn("default 8080", note)

    def test_custom_default_port(self):
        target, note = app.normalize_target("host.example.com", 5060)
        self.assertEqual(target, "host.example.com:5060")
        self.assertIn("default 5060", note)

    def test_full_url_scheme_path_and_query_are_ignored(self):
        target, note = app.normalize_target("https://host.example.com:8080/x?y=1")
        self.assertEqual(target, "host.example.com:8080")
        self.assertIn("ignored URL path", note)
        self.assertIn("ignored query/fragment", note)

    def test_ipv6_literal_keeps_brackets(self):
        target, _ = app.normalize_target("[2001:db8::1]:8080")
        self.assertEqual(target, "[2001:db8::1]:8080")

    def test_rejects_empty(self):
        for bad in ("", "   ", "''"):
            with self.assertRaises(ValueError):
                app.normalize_target(bad)

    def test_rejects_userinfo(self):
        with self.assertRaises(ValueError):
            app.normalize_target("http://user:pass@host.example.com:8080")

    def test_rejects_invalid_port(self):
        with self.assertRaises(ValueError):
            app.normalize_target("host.example.com:99999")
        with self.assertRaises(ValueError):
            app.normalize_target("host.example.com:0")


class TestParseHost(unittest.TestCase):
    def test_accepts_normal_host(self):
        self.assertEqual(app.parse_host("host.example.com:8080"), ("host.example.com", 8080))

    def test_strips_ipv6_brackets(self):
        self.assertEqual(app.parse_host("[::1]:8080"), ("::1", 8080))

    def test_rejects_path_and_scheme(self):
        for bad in ("host.example.com:8080/x", "http://host:8080", "host:8080?q=1",
                    "host:8080#f", "us er:8080", "host@evil:8080"):
            with self.assertRaises(ValueError):
                app.parse_host(bad)

    def test_rejects_bad_label_shapes(self):
        for bad in ("-lead.example.com:8080", "trail-.example.com:8080", "a..b:8080",
                    ".example.com:8080", "example.com.:8080", "a_b:8080"):
            with self.assertRaises(ValueError):
                app.parse_host(bad)


class TestHostHeader(unittest.TestCase):
    """Regression: IPv6 literals must stay bracketed in the Host field."""

    def test_ipv4(self):
        self.assertEqual(app.host_header_for("example.com", 8080), "example.com:8080")
        self.assertEqual(app.host_header_for("example.com", 80), "example.com")

    def test_ipv6(self):
        self.assertEqual(app.host_header_for("::1", 8080), "[::1]:8080")
        self.assertEqual(app.host_header_for("::1", 80), "[::1]")

    def test_url_builder(self):
        self.assertEqual(app.url_for("http", "::1", 8080, "/x"), "http://[::1]:8080/x")
        self.assertEqual(app.url_for("https", "example.com", 443, "/y"), "https://example.com:443/y")


class TestResolveHostPolicy(unittest.TestCase):
    """Regression: a name that resolves to both a public and a private address
    must never silently fall back to the private one."""

    def setUp(self):
        self._orig = socket.getaddrinfo

    def tearDown(self):
        socket.getaddrinfo = self._orig

    def _patch(self, addrs):
        def fake(host, port, *a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in addrs]
        socket.getaddrinfo = fake

    def test_private_only_rejected_without_flag(self):
        self._patch(["192.168.10.5"])
        with self.assertRaises(ValueError):
            app.resolve_host("mixed.example", 8080, allow_private=False)

    def test_private_allowed_with_flag(self):
        self._patch(["192.168.10.5"])
        got = app.resolve_host("mixed.example", 8080, allow_private=True)
        self.assertEqual([a["ip"] for a in got], ["192.168.10.5"])

    def test_mixed_resolution_drops_private_address(self):
        self._patch(["8.8.8.8", "192.168.10.5"])
        got = app.resolve_host("mixed.example", 8080, allow_private=False)
        self.assertEqual([a["ip"] for a in got], ["8.8.8.8"])
        self.assertNotIn("192.168.10.5", [a["ip"] for a in got])

    def test_mixed_resolution_keeps_both_with_flag(self):
        self._patch(["8.8.8.8", "192.168.10.5"])
        got = app.resolve_host("mixed.example", 8080, allow_private=True)
        self.assertEqual(sorted(a["ip"] for a in got), ["192.168.10.5", "8.8.8.8"])

    def test_address_records_carry_their_port(self):
        self._patch(["8.8.8.8"])
        got = app.resolve_host("example.test", 9999, allow_private=False)
        self.assertEqual(got[0]["port"], 9999)


class TestDetectScheme(unittest.TestCase):
    def test_schemes(self):
        self.assertEqual(app.detect_scheme("https://host:8080"), "https")
        self.assertEqual(app.detect_scheme("http://host:8080"), "http")
        self.assertIsNone(app.detect_scheme("host:8080"))
        self.assertIsNone(app.detect_scheme("host"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
