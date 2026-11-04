# FINDINGS.md — every confirmed finding of this audit

Each finding follows the audit cycle
**OBSERVE → REPRODUCE → ROOT CAUSE → FIX → REGRESSION → OFFICIAL VALIDATION → REVIEW.**

Severity: **HIGH** (security or wrong verdict on a real server) /
**MEDIUM** (correctness or robustness under realistic conditions) /
**LOW** (hygiene, diagnostics, portability).

| ID | Severity | Area | Title | Status |
| --- | --- | --- | --- | --- |
| F-01 | MEDIUM | performance | `read_body()` was quadratic | fixed |
| F-02 | LOW | correctness | IPv6 authority was malformed (`::1:8080`) | fixed |
| F-03 | **HIGH** | security | private-network policy bypass (SSRF) | fixed |
| F-04 | MEDIUM | security | arbitrary file read through `ca_bundle` | fixed |
| F-05 | MEDIUM | robustness | socket leak on every error path | fixed |
| F-06 | MEDIUM | robustness | no global time budget for a run | fixed |
| F-07 | LOW | robustness | oversized request bodies silently truncated | fixed |
| F-08 | MEDIUM | protocol | WebSocket upgrade validation was too weak | fixed |
| F-09 | MEDIUM | protocol | the URL scheme was recorded but ignored | fixed |
| F-10 | LOW | maintainability | private API + temp file to describe a certificate | fixed |
| F-11 | MEDIUM | correctness | the legacy probes could hit the wrong port | fixed |
| F-12 | LOW | hardening | missing `X-Content-Type-Options` | fixed |
| F-13 | LOW | diagnostics | TLS errors hid the OpenSSL verify code | fixed |
| F-14 | MEDIUM | portability | laboratory scripts hardcoded `/home/user/...` | fixed |
| F-15 | MEDIUM | supply chain | the laboratory depended on a third-party mirror | fixed |
| F-16 | MEDIUM | compliance | proprietary binaries were committed | fixed |
| F-17 | MEDIUM | process | no regression suite existed | fixed |
| F-18 | MEDIUM | process | the required `validation/` set did not exist | fixed |
| F-19 | LOW | hygiene | duplicated `USER_AGENT`, unused imports | fixed |
| F-20 | MEDIUM | robustness | the web API could return an unhandled 500 | fixed |
| F-21 | MEDIUM | laboratory | two daemons could share port 8080 (`SO_REUSEPORT`) | fixed |
| F-22 | MEDIUM | laboratory | the isolated CLI scope never started its stub | fixed |

---

## F-01 — `read_body()` was quadratic

**OBSERVE.** A full host-tester run spent seconds in `read_body()`.
**REPRODUCE.**

| body | quadratic implementation | linear implementation |
| ---: | ---: | ---: |
| 1 MB | 0.003 s | < 0.001 s |
| 8 MB | 0.180 s | < 0.005 s |
| 32 MB | 2.500 s | < 0.020 s |

**ROOT CAUSE.** the loop executed `len(b"".join(chunks)) < limit` on every
iteration, re-copying the whole buffer each time — O(n²) in the body size.
**FIX.** count the retained bytes in an integer instead of re-joining.
**REGRESSION.** `tests/test_security.py::TestResourceLimits::test_read_body_is_linear`
asserts that an 8 MB body is processed in < 50 ms.
**OFFICIAL VALIDATION.** the 19-check run against the official daemon still
passes 19/19 and still reports the exact byte counts of the ten image files
(`lab/results/final-hosttester-tls.json`).
**REVIEW.** the byte accounting is unchanged: `total` still reports the real
number of bytes the server sent, which is what the size comparison needs.

## F-02 — IPv6 authority was malformed

**OBSERVE.** the result of a run against `[::1]:8080` contained
`latency_url : http://::1:8080/speedtest/latency.txt`.
**ROOT CAUSE.** the `Host` header and the URL builder concatenated
`host + ":" + port` without bracketing an IPv6 literal.
**FIX.** `host_header_for()` and `url_for()` bracket IPv6.
**REGRESSION.** `tests/test_normalize.py::TestHostHeader` (3 cases).
**REVIEW.** the RFC 7230 authority is now valid for both families.

## F-03 — private-network policy bypass (SSRF)

**OBSERVE.** see `SECURITY_AUDIT.md` §2.
**ROOT CAUSE.** the policy was expressed as "does the name resolve to *any*
public address" instead of "may this process dial *this* address".
**FIX.** non-global addresses are removed at resolution time.
**REGRESSION.** 4 cases in `tests/test_normalize.py::TestResolveHostPolicy`.
**OFFICIAL VALIDATION.** the laboratory runs with `--allow-private`, which
still works, and the public-path behaviour is unchanged for global addresses.
**REVIEW.** the `resolved` block of the JSON now only lists addresses the
process may actually dial — a small, documented behaviour change.

## F-04 — arbitrary file read through `ca_bundle`

**OBSERVE.** see `SECURITY_AUDIT.md` §2.
**ROOT CAUSE.** a web-supplied path was passed to an unrestricted file reader.
**FIX.** `restrict_ca_path()` confines web requests to the application
directory or an explicitly allowed directory.
**REGRESSION.** 5 unit cases + 1 end-to-end case.
**REVIEW.** the CLI keeps the unrestricted behaviour on purpose.

## F-05 — socket leak on every error path

**OBSERVE.** `ResourceWarning: unclosed <socket.socket …>` while running the
protocol suite against a server that misbehaves.
**ROOT CAUSE.** `sock.close()` was only reached on the success path.
**FIX.** `try/finally` in `raw_http()`, `netgauge_check()`,
`websocket_check()`, `keepalive_check()` and `cert_info()`.
**REGRESSION.** the whole suite runs under `-W error::ResourceWarning`.
**REVIEW.** `cert_info()` additionally no longer needs a temporary file.

## F-06 — no global time budget

**OBSERVE.** a single run could occupy a worker thread for minutes.
**ROOT CAUSE.** only per-probe timeouts existed.
**FIX.** `--timeout` (default 180 s) with a `contextvars` deadline that
clamps every socket timeout and short-circuits the remaining checks.
**REGRESSION.** `tests/test_protocol.py::TestDeadline`.
**REVIEW.** the new `options.timeout` and `options.daemon_tls_source` fields
are additive.

## F-07 — oversized request bodies silently truncated

**ROOT CAUSE.** `min(length, 16384)` without a rejection path.
**FIX.** HTTP **413** above the limit.
**REGRESSION.** `tests/test_security.py::TestWebApiHardening`.

## F-08 — WebSocket upgrade validation was too weak

**OBSERVE.** the old code searched the whole response head for the string
`101 Switching Protocols` and for the expected `Sec-WebSocket-Accept` value.
A server could satisfy both by putting the value in an unrelated header.
**ROOT CAUSE.** the response head was never parsed into headers.
**FIX.** `parse_http_head()`; the status line must be `101 Switching
Protocols`, `Upgrade` must be `websocket`, `Connection` must contain
`upgrade`, and `Sec-WebSocket-Accept` must equal the expected value **as a
header**.
**REGRESSION.** `tests/test_protocol.py::TestWebSocket` (3 cases).
**OFFICIAL VALIDATION.** the official daemon still passes the check
(`lab/results/final-hosttester-tls.json`).

## F-09 — the URL scheme was recorded but ignored

**OBSERVE.** typing `https://host:8080` produced `transport : plain TCP`.
**ROOT CAUSE.** `input_scheme` was stored as metadata only, and the CLI
normalised the input *before* handing it to the engine, so the scheme was
lost.
**FIX.** the engine now receives the **original** input and derives the
transport from it: `https://` → TLS for the NetGauge/WebSocket/crossdomain
probes.  `--daemon-tls` and `--no-daemon-tls` override it; the web form
accepts `daemon_tls=1` / `daemon_tls=0`.
**REGRESSION.** `tests/test_protocol.py::TestSchemeSelectsTransport` (3 cases).
**OFFICIAL VALIDATION.** `https://localhost:8080` against the official daemon
now reports `transport : TLS` and `transport : wss / TLS` and still scores
19/19.

## F-10 — private API and temporary file to describe a certificate

**OBSERVE.** `cert_info()` called the private `ssl._ssl._test_decode_cert()`
and wrote the certificate to a temporary file outside the project directory.
**ROOT CAUSE.** the standard library offers no public X.509 decoder.
**FIX.** a small, self-contained DER reader (`describe_certificate()`) renders
the subject, issuer and validity period directly from the DER bytes.
**REGRESSION.** the output is compared with `openssl x509 -subject -issuer
-dates` — identical.
**REVIEW.** no private API, no temporary file, no write outside the project.

## F-11 — the legacy probes could hit the wrong port

**OBSERVE.** when the legacy port could not be resolved, the code fell back to
the *daemon's* address list, whose `sockaddr` still pointed at the **daemon
port**, while the request was labelled with the legacy port.
**ROOT CAUSE.** the port was carried inside the address record instead of
being re-stamped when the list was reused.
**FIX.** the fallback re-stamps the port, so a probe always reaches the port
it claims to probe.
**REGRESSION.** `tests/test_normalize.py::TestResolveHostPolicy::test_address_records_carry_their_port`.

## F-12 — missing `X-Content-Type-Options`

**FIX.** every response carries `X-Content-Type-Options: nosniff`.

## F-13 — TLS errors hid the OpenSSL verify code

**OBSERVE.** an untrusted certificate was reported as
`SSL certificate problem: self-signed certificate`, which is misleading when
the leaf is in fact signed by an unknown CA.
**FIX.** `ssl_error_phrase()` now appends the OpenSSL verify code and
distinguishes *expired* and *not yet valid* leaves.
**REGRESSION.** `tests/test_security.py::TestTlsVerificationIsNeverDisabled`.

## F-14 — laboratory scripts hardcoded `/home/user/...`

**OBSERVE.** every script in `ooklaserver/sim/scripts/` used absolute
`/home/user/...` paths and therefore did not work in the actual repository
layout (`repo/arena.ai/...`).
**ROOT CAUSE.** the scripts were written for a flat working directory.
**FIX.** every script derives its paths from `$(dirname "$0")`.
**REVIEW.** the laboratory now works from a fresh clone at any location.

## F-15 — the laboratory depended on a third-party mirror

**OBSERVE.** the legacy-fallback control read a 95 MB archive fetched from
`http://speedtest.lungit.com/http_legacy_fallback.zip`.
**ROOT CAUSE.** the official legacy package is not redistributable and has no
stable official URL.
**FIX.** `lab/scripts/legacy_control.py` reproduces the *observable
contract* locally (the ten byte sizes, the `size=` formula, `test=test`, the
crossdomain policy, keep-alive).  It is labelled a **control**, not the
official package, and the byte sizes were independently re-confirmed against
the genuine daemon.
**REVIEW.** the laboratory no longer needs the network for its own fixtures.

## F-16 — proprietary binaries were committed

**OBSERVE.** the repository tracked `OoklaServer` (15 MB), its aarch64 build,
both tarballs and the Speedtest CLI.
**ROOT CAUSE.** the previous session staged the binaries for convenience.
**FIX.** `git rm --cached`; `arena.ai/.gitignore` now excludes them;
`lab/scripts/download-official.sh` downloads and **hash-verifies** them.
**REVIEW.** the binaries stay on disk for the current session, and the
expected SHA-256 values are recorded in `lab/binaries/MANIFEST.md` and
`lab/cli/MANIFEST.md`.

## F-17 — no regression suite existed

**FIX.** `tests/` with 77 tests in four suites, runnable with
`sh tests/run_tests.sh`.  See `TEST_MATRIX.md` §3.

## F-18 — the required `validation/` set did not exist

**FIX.** this directory.  See `CONTEXT_BASELINE.md` §2.

## F-19 — duplicated `USER_AGENT`, unused imports

**FIX.** `secrets`, `string` and `tempfile` were imported but unused and
`USER_AGENT` was defined twice; all removed.

## F-20 — the web API could return an unhandled 500

**ROOT CAUSE.** only `ValueError` was caught; any other exception produced a
default HTML traceback page from the base class.
**FIX.** `GET /api/test` now answers with a JSON error object and status 500,
and `GET /host-tester?run=1` re-renders the form with the error.

## F-21 — two daemons could share port 8080

**OBSERVE.** after a restart of the laboratory, `ss -lntup` showed **two**
`OoklaServer` processes listening on `127.0.0.1:8080`.  Every measurement
taken in that state was therefore non-deterministic: the kernel distributes
incoming connections between the two instances.

**ROOT CAUSE.** OoklaServer binds its data plane with `SO_REUSEPORT`, so a
second instance starts happily on an occupied port.  The daemon's `--pidfile`
does not prevent this, and the stale PID file pointed at the newer process
only.

**FIX.** `start-daemon.sh` now checks port 8080 before starting and refuses
with exit code 4; `cross-validate-cli.sh` stops any running daemon first.
`stop-daemon.sh` already escalates `SIGTERM` → `SIGKILL`, because the daemon
**ignores `SIGTERM`**.

**REGRESSION.** the variant matrix and every host-tester run are executed
against a single, verified daemon instance.

## F-22 — the isolated CLI scope never started its control-plane stub

**OBSERVE.** `cross-validate-cli.sh https isolated` failed with
`Network is Unreachable` / `Cannot retrieve configuration document (0)`
instead of the documented `LICENSE_ERROR`.

**ROOT CAUSE.** the stub was started through `sudo` **from inside** the
`unshare -rn` namespace.  `sudo` cannot run there (`sudo: unable to open
/etc/sudoers: Invalid argument`), so the stub never started and the CLI had
nothing to talk to.

**FIX.** inside a user namespace the process is uid 0 with a full capability
set over that namespace and can bind the privileged port 443 directly, so the
script now starts the stub **unprivileged** in the `isolated` scope and with
`sudo -n` in the `real` scope.

**REGRESSION.** the isolated scope now reproduces the documented behaviour
exactly: the stub answers the config API with **HTTP 200** over TLS with the
laboratory CA, the server list is honoured, and the CLI then aborts with
`LICENSE_ERROR` / `InvalidLicenseKey` (exit 2).
Artefact: `lab/results/cli-cross-validation-https-isolated.log`.

---

## Prior claims, re-evaluated

| Prior claim (from `AUDIT.md` / `SIMULASI.md`) | Class after this audit | Evidence |
| --- | --- | --- |
| "18/19 in HTTP mode, 19/19 in HTTPS mode against the official daemon" | **VERIFIED** (in a stricter form) | the daemon itself now satisfies the legacy checks, so the third-party simulator is no longer needed; `lab/results/final-hosttester-tls.json` |
| "the official CLI completed a full test against the local daemon, exit 0" | **VERIFIED**, with the publication risk removed | `lab/results/cli-cross-validation-https.json`, `persisted: false`, upload intercepted with 503 |
| "the daemon serves HTTP and HTTPS on the same port" | **VERIFIED** | `lab/results/probe-https.json`, `openssl s_client` |
| "`upload.php` returns the raw Content-Length on the daemon" | **VERIFIED** | four body sizes measured |
| "the daemon serves the ten legacy images with the official byte sizes" | **VERIFIED** (new evidence — the previous session only observed this through the third-party simulator) | `lab/results/probe-http.json` |
| "UDP 8080 is opened by the daemon" | **VERIFIED, but not usable** | the daemon does not answer a NetGauge datagram, so no UDP check was added |
| "the form page is 1:1" | **PARTIALLY VERIFIED** — the DOM/CSS comparison of the previous session was not repeated here (no browser tooling in this session); the structural contract (`action`, `method`, field names, absence of reCAPTCHA and external assets) **was** re-verified | `tests/test_security.py::TestWebApiHardening` |
| "the official result page is an approximation" | **VERIFIED** | the official backend stays behind reCAPTCHA and was not bypassed |
