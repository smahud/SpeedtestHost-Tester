# TEST_MATRIX.md — every test that was run, with its real outcome

No result in this document is estimated.  "PASSED/FAILED" always refers to
the clone's own 19-check verdict; "exit" is the CLI exit code.

## 1. Host tester against the **official OoklaServer 2.11.5.2** (port 8080)

### 1.1 Daemon in TLS mode, laboratory CA trusted

| # | Command | Result | Exit |
| --- | --- | --- | ---: |
| T-01 | `cli.py localhost:8080 --allow-private --ca-bundle lab/certs/ca.crt --legacy-port 8080 --upload-mode auto` | **19 PASSED / 0 FAILED** | 0 |
| T-02 | `cli.py 'https://localhost:8080' … --legacy-port 8080` (scheme selects TLS) | **19 PASSED / 0 FAILED** | 0 |
| T-03 | `cli.py localhost:8080 … --legacy-port 8080 --daemon-tls` | **19 PASSED / 0 FAILED** | 0 |
| T-04 | `cli.py localhost:8080 … --legacy-port 8080 --upload-mode native` | **19 PASSED / 0 FAILED** | 0 |
| T-05 | web `GET /api/test?host=localhost:8080&allow_private=1&ca_bundle=…&legacy_port=8080` | **19 PASSED / 0 FAILED** | HTTP 200 |

Artefacts: `lab/results/final-hosttester-tls.json`,
`lab/results/variants/tls-legacy8080.json`, `lab/results/variants/tls-daemon-tls.json`.

### 1.2 Negative controls (each must fail, and does)

| # | Scenario | Expected | Observed | Exit |
| --- | --- | --- | --- | ---: |
| T-06 | `--ca-bundle` **not** given (certificate is not publicly trusted) | `https` FAILED | 18/1, `https` FAILED with `self-signed certificate` + openssl verify code | 1 |
| T-07 | `--ca-bundle lab/certs/untrusted.crt` (wrong CA) | `https` FAILED | 18/1, `https` FAILED | 1 |
| T-08 | `--upload-mode legacy` against the daemon (native algorithm) | `upload` + `max_upload` FAILED | 17/2, exactly those two FAILED | 1 |
| T-09 | `--legacy-port 80` while nothing listens there | all 6 legacy checks FAILED | 4/15 — the 4 daemon checks still PASSED | 1 |
| T-10 | `[::1]:8080` (daemon binds IPv4 only) | all FAILED with "Connection refused" | 0/19, error `::1: [Errno 111] Connection refused` | 1 |
| T-11 | daemon in **plain HTTP** mode (no TLS context) | `https` FAILED, everything else PASSED | 18/1 | 1 |
| T-12 | invalid input (`ftp://bad host:99999`) | exit 2, no traceback | exit 2, `Invalid hostname format` | 2 |
| T-13 | `--ca-bundle /etc/hosts` (not a PEM) | exit 2 | exit 2, `does not contain a PEM certificate` | 2 |
| T-14 | `--ca-bundle /nonexistent.pem` | exit 2 | exit 2, `not a readable file` | 2 |
| T-15 | `--legacy-port 99999` | exit 2 | exit 2 | 2 |
| T-16 | `--port 0` | exit 2 | exit 2 | 2 |
| T-17 | `--timeout 0` | exit 2 | exit 2 | 2 |

Artefacts: `lab/results/variants/*.json`.

### 1.3 Raw daemon probe (no clone code involved)

`lab/scripts/probe-daemon.py` talks to the daemon directly.

| # | Probe | Result |
| --- | --- | --- |
| T-18 | raw TCP `HI\n` | PASS — `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d` |
| T-19 | `GET /hi`, `GET /`, `GET /crossdomain.xml`, `GET /speedtest/latency.txt` | INFO — all `200` with the expected bodies |
| T-20 | `GET /speedtest/upload.php` (GET, not POST) | INFO — `404` (POST-only endpoint) |
| T-21 | `POST /speedtest/upload.php` × 4 body sizes | INFO — `size=` equals the raw Content-Length every time |
| T-22 | 10 × `GET /speedtest/randomNxN.jpg` | **10/10 PASS** — exact official byte sizes, `image/jpeg`, JPEG magic |
| T-23 | WebSocket upgrade + `HI` frame | PASS — `101`, valid accept, `HELLO` frame |
| T-24 | keep-alive: two requests on one socket | PASS — `Keep-Alive`, second response in 0.37 ms |
| T-25 | UDP `HI` datagram (6 payload variants) | **TIMEOUT** — the daemon does not answer on UDP |
| T-26 | TLS probe of the daemon (HTTPS mode) | PASS — `TLSv1.3`, verify 0 |
| T-27 | plain HTTP and HTTPS **simultaneously** on 8080 | PASS — both `200` at the same time |

Artefacts: `lab/results/probe-http.json`, `lab/results/probe-https.json`.

## 2. Official Speedtest CLI ↔ official OoklaServer

| # | Scope | Result | Exit | Published? |
| --- | --- | --- | ---: | --- |
| C-01 | daemon in TLS mode, real Ookla control plane | `server.ip = 127.0.0.1`, ping 0.105 ms (0.082–0.140), loss 0 %, ↓ 11.36 GB/s, ↑ 8.26 GB/s, `persisted: false` | **0** | **no** — upload intercepted locally, HTTP 503 |
| C-02 | daemon in plain HTTP mode, real control plane | `server.ip = 127.0.0.1`, ping 0.079 ms (0.072–0.105), loss 0 %, ↓ 11.95 GB/s, ↑ 7.70 GB/s, `persisted: false` | **0** | **no** — upload intercepted locally, HTTP 503 |
| C-03 | fully isolated network namespace, stubbed control plane | the stub answered the config API over TLS (**HTTP 200**) and the server list was honoured, but the CLI then aborted with `LICENSE_ERROR` / `InvalidLicenseKey` | 2 | no |

Artefacts: `lab/results/cli-cross-validation-{https,http}-real.{json,log}`,
`lab/results/cli-cross-validation-https-isolated.log`,
`lab/results/cli-stub-state.json`.

Details and evidence: `CROSS_VALIDATION.md`.

## 3. Regression suite (`arena.ai/tests/`)

Run with `sh tests/run_tests.sh`.  No network access is required for the
first three suites; the fourth is skipped automatically when no daemon is
reachable.

| Suite | Tests | Result |
| --- | ---: | --- |
| `test_normalize.py` — input normalisation, target validation, address policy, Host header | 21 | **OK** |
| `test_protocol.py` — every check against a controllable fake daemon, incl. negative paths | 27 | **OK** |
| `test_security.py` — CA path restriction, TLS policy, resource limits, web hardening, secret scan | 20 | **OK** |
| `test_integration_official.py` — against the genuine official daemon | 9 | **OK** |
| **Total** | **77** | **all passed** |

The suite is run with `-W error::ResourceWarning` in addition, which turns a
leaked socket into a test failure (this is how finding F-08 was detected).

## 4. Web layer end-to-end

| # | Request | Expected | Observed |
| --- | --- | --- | --- |
| W-01 | `GET /host-tester` | 200, original form markup | 200, `action="/host-tester"`, `method="post"`, `name="ookla-server"`, `id="ookla-server"` |
| W-02 | `GET /host-tester` (content scan) | no reCAPTCHA, no external assets | no `google.com/recaptcha`, no `data-sitekey`, no `g-recaptcha` element, no `<script src=`, no `url(http` |
| W-03 | `GET /host-tester?clean=1` | test-only view | 200, nav/footer hidden |
| W-04 | `POST /host-tester` with a valid target | result page | 200 |
| W-05 | `POST /host-tester` with an invalid target | form + error | 200, `clone-alert` |
| W-06 | `POST /host-tester` with a 40 kB body | rejected | **413** |
| W-07 | `GET /api/test` without a host | 400 JSON | 400, `{"error": "missing host"}` |
| W-08 | `GET /api/test?…&ca_bundle=/etc/ssl/certs/ca-certificates.crt` | 400 JSON | 400, `ca_bundle must point inside the application directory` |
| W-09 | `GET /api/test?host=127.0.0.1:1&allow_private=1` | 200 JSON, 19 checks | 200, `summary.total = 19` |
| W-10 | `GET /` | redirect | 302 → `/host-tester` |
| W-11 | `GET /favicon.ico` | 204 | 204 |
| W-12 | `GET /nope` | 404 page | 404 |
| W-13 | `GET /assets/inline.css` | 200 CSS | 200 |

## 5. Performance

| # | Measurement | Before the fix | After the fix |
| --- | --- | --- | --- |
| P-01 | `read_body()` with an 8 MB body | 0.180 s | < 0.005 s (linear) |
| P-02 | `read_body()` with a 32 MB body | 2.500 s | < 0.02 s |
| P-03 | full 19-check run against the daemon | 3.4 s | 3.4 s |

F-01 was quadratic because the loop re-joined the buffer for every chunk; the
image checks alone wasted ~5 s of pure `memcpy` per run.

## 6. Results that are **not** claimed

* The official `speedtest.net/host-tester` backend and result page were
  never observed (reCAPTCHA was not bypassed) — **UNVERIFIABLE**.
* The loopback bandwidth figures above (10+ GB/s) are a property of the
  loopback interface and **must never** be presented as internet capacity.
* Whether the official tester performs a UDP probe is **UNVERIFIABLE**; the
  daemon does not answer a NetGauge datagram, so such a probe would report a
  false failure.
