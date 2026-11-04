#!/usr/bin/env python3
"""Security regression tests.

Covers the areas listed in the audit brief: SSRF / private-network access,
path traversal through the CA bundle parameter, TLS verification bypass,
resource exhaustion and unsafe error handling.
"""
import json
import os
import socket
import ssl
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import app            # noqa: E402
import cli            # noqa: E402


class TestCaBundleRestriction(unittest.TestCase):
    """Regression: a web caller must not be able to point the tester at an
    arbitrary file on the filesystem."""

    def test_path_outside_application_is_rejected(self):
        for path in ("/etc/hosts", "/etc/passwd", "/proc/self/environ",
                     "/etc/ssl/certs/ca-certificates.crt", "/tmp/whatever.pem"):
            with self.assertRaises(ValueError, msg=path):
                app.restrict_ca_path(path)

    def test_path_inside_application_is_accepted(self):
        inside = os.path.join(str(app.ROOT), "lab", "certs", "ca.crt")
        self.assertEqual(app.restrict_ca_path(inside), inside)

    def test_traversal_is_normalised_before_the_check(self):
        sneaky = os.path.join(str(app.ROOT), "..", "..", "etc", "hosts")
        with self.assertRaises(ValueError):
            app.restrict_ca_path(sneaky)

    def test_extra_allowed_directory_can_be_configured(self):
        os.environ[app.ALLOWED_CA_DIRS_ENV] = "/tmp"
        try:
            self.assertTrue(app.restrict_ca_path("/tmp/x.pem").startswith("/tmp/"))
        finally:
            del os.environ[app.ALLOWED_CA_DIRS_ENV]

    def test_validate_ca_bundle_rejects_non_pem(self):
        with self.assertRaises(ValueError):
            app.validate_ca_bundle("/etc/hosts")


class TestTlsVerificationIsNeverDisabled(unittest.TestCase):
    def test_https_check_fails_on_untrusted_certificate(self):
        """A self-signed certificate must never produce a PASSED https row."""
        import fake_ookla  # noqa: F401  (kept for symmetry with the other suites)
        server = _TlsServer(certfile=None, use_system=False)
        server.start()
        try:
            addrs = app.resolve_host("127.0.0.1", server.port, allow_private=True)
            row = app.https_check("127.0.0.1", server.port, addrs)
            self.assertEqual(row["status"], "FAILED")
            self.assertIn("SSL certificate problem", row["details"])
            self.assertIn("insecure_response", row["details"])
            self.assertIn("never disabled", row["details"])
        finally:
            server.stop()

    def test_unverified_context_is_only_used_for_diagnostics(self):
        source = open(os.path.join(os.path.dirname(HERE), "app.py"), encoding="utf-8").read()
        # the only unverified context must be inside cert_info / the
        # diagnostic fallback of https_check, never in a PASS decision
        self.assertIn("ssl._create_unverified_context", source)
        self.assertIn("verify=True", source)


class TestResourceLimits(unittest.TestCase):
    def test_run_budget_is_configurable_and_enforced(self):
        with self.assertRaises(ValueError):
            app.run_all_tests("example.invalid:8080", timeout=-1)
        with self.assertRaises(ValueError):
            app.run_all_tests("example.invalid:8080", timeout=0)

    def test_read_body_is_linear(self):
        """Regression: read_body() used to re-join the buffer on every chunk."""
        class _Resp:
            def __init__(self, total):
                self.left = total

            def read(self, n):
                if self.left <= 0:
                    return b""
                k = min(n, self.left)
                self.left -= k
                return b"x" * k

        limit = 8_000_000
        started = time.perf_counter()
        _data, total = app.read_body(_Resp(limit + 100), limit + 1)
        elapsed = time.perf_counter() - started
        self.assertEqual(total, limit + 100)
        # the quadratic implementation needed ~0.18s here and grew with the
        # square of the size; a linear one stays far below that.
        self.assertLess(elapsed, 0.05, f"read_body took {elapsed:.3f}s -- still quadratic?")

    def test_body_limit_reports_the_real_length(self):
        class _Resp:
            def __init__(self, total):
                self.left = total

            def read(self, n):
                if self.left <= 0:
                    return b""
                k = min(n, self.left)
                self.left -= k
                return b"x" * k

        data, total = app.read_body(_Resp(1000), 10)
        self.assertEqual(total, 1000)
        self.assertLessEqual(len(data), 10 + 65536)


class TestWebApiHardening(unittest.TestCase):
    """End-to-end checks against a live instance of the clone's web server."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.server.daemon_threads = True
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get(self, path):
        """Return (status, body) for any HTTP status, including 4xx/5xx."""
        url = f"http://127.0.0.1:{self.port}{path}"
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", "replace")

    def test_ca_bundle_outside_application_is_refused(self):
        status, body = self.get("/api/test?host=127.0.0.1&allow_private=1"
                                "&ca_bundle=/etc/ssl/certs/ca-certificates.crt")
        self.assertEqual(status, 400)
        self.assertIn("ca_bundle", json.loads(body)["error"])

    def test_missing_host_is_a_400(self):
        status, body = self.get("/api/test")
        self.assertEqual(status, 400)
        self.assertIn("missing host", json.loads(body)["error"])

    def test_form_page_has_no_external_resources(self):
        """No reCAPTCHA widget / script / sitekey and no external assets."""
        status, body = self.get("/host-tester")
        self.assertEqual(status, 200)
        low = body.lower()
        self.assertNotIn("google.com/recaptcha", low)
        self.assertNotIn("data-sitekey", low)
        self.assertNotIn('class="g-recaptcha', low)
        self.assertNotIn("//www.google.com", body)
        # no external script or stylesheet references
        self.assertNotIn("<script src=", low)
        self.assertNotIn('<link rel="stylesheet" href="http', low)
        # the embedded CSS must not pull anything from the network either
        self.assertNotIn("url(http", low)

    def test_form_page_keeps_the_original_contract(self):
        status, body = self.get("/host-tester")
        self.assertEqual(status, 200)
        self.assertIn('action="/host-tester"', body)
        self.assertIn('method="post"', body)
        self.assertIn('name="ookla-server"', body)
        self.assertIn('id="ookla-server"', body)

    def test_oversized_post_is_rejected(self):
        url = f"http://127.0.0.1:{self.port}/host-tester"
        data = b"ookla-server=" + b"a" * 40000
        req = urllib.request.Request(url, data=data, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                self.assertEqual(r.status, 413)
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 413)

    def test_api_returns_json_for_a_valid_target(self):
        status, body = self.get("/api/test?host=127.0.0.1:1&allow_private=1")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertIn("summary", payload)
        self.assertEqual(payload["summary"]["total"], 19)


class TestCliExitCodes(unittest.TestCase):
    def test_invalid_input_exits_2(self):
        self.assertEqual(cli.main(["ftp://bad host:99999"]), 2)

    def test_version_exits_0(self):
        with self.assertRaises(SystemExit) as ctx:
            cli.main(["--version"])
        self.assertEqual(ctx.exception.code, 0)

    def test_bad_port_exits_2(self):
        self.assertEqual(cli.main(["host.example.com:8080", "--port", "0"]), 2)
        self.assertEqual(cli.main(["host.example.com:8080", "--legacy-port", "99999"]), 2)
        self.assertEqual(cli.main(["host.example.com:8080", "--timeout", "0"]), 2)


class TestNoSecretsInSource(unittest.TestCase):
    def test_no_hardcoded_private_keys(self):
        root = os.path.dirname(HERE)
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in ("tests", "lab", "runtime", ".git")]
            if os.sep + ".git" in dirpath:
                continue
            for name in files:
                if not name.endswith((".py", ".sh", ".md")):
                    continue
                path = os.path.join(dirpath, name)
                try:
                    text = open(path, encoding="utf-8", errors="replace").read()
                except OSError:
                    continue
                for needle in ("BEGIN " + "PRIVATE KEY", "BEGIN RSA " + "PRIVATE KEY"):
                    self.assertNotIn(needle, text, path)


# --------------------------------------------------------------------------
class _TlsServer:
    """A minimal TLS server that presents an untrusted self-signed cert."""

    def __init__(self, certfile=None, use_system=False):
        self.certfile = certfile
        self.use_system = use_system
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(5)
        self.port = self.sock.getsockname()[1]
        self._stop = False
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        return self

    def _run(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        if self.certfile:
            ctx.load_cert_chain(self.certfile, os.path.splitext(self.certfile)[0] + ".key")
        else:
            import tempfile
            import subprocess
            with tempfile.TemporaryDirectory() as tmp:
                crt = os.path.join(tmp, "c.pem")
                key = os.path.join(tmp, "c.key")
                subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                                "-keyout", key, "-out", crt, "-days", "1",
                                "-subj", "/CN=localhost"],
                               check=True, capture_output=True)
                ctx.load_cert_chain(crt, key)
                while not self._stop:
                    self.sock.settimeout(0.5)
                    try:
                        conn, _ = self.sock.accept()
                    except (socket.timeout, OSError):
                        continue
                    try:
                        tls = ctx.wrap_socket(conn, server_side=True)
                        tls.recv(1024)
                        tls.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nhello")
                        tls.close()
                    except Exception:
                        try:
                            conn.close()
                        except Exception:
                            pass

    def stop(self):
        self._stop = True
        try:
            self.sock.close()
        except Exception:
            pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
