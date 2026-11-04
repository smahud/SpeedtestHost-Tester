# SECURITY_AUDIT.md — attack surface, findings and residual risk

Scope: the clone as a **network service** (`app.py`, port 3000) and as a
**local CLI** (`cli.py`).  The official binaries in the laboratory are trusted
reference implementations and are not audited.

---

## 1. Threat model

| Asset | Concern |
| --- | --- |
| the web server | reachable by anyone who can reach port 3000 (the Arena preview) |
| the tester process | must not be turned into an SSRF / file-read / resource-exhaustion proxy |
| the laboratory | must not publish laboratory measurements or touch the public internet |
| the repository | must not contain credentials, private keys or proprietary binaries |

---

## 2. Findings and their resolution

### F-03 — SSRF / private-network policy bypass *(HIGH, fixed)*

**Before:** `resolve_host()` only asked "is **at least one** resolved address
global?".  A name that resolves to both a public and a private address was
accepted, and `connect_first()` then tried **every** address in turn, so a
failure on the public address silently fell back to the RFC1918 one — with
`--allow-private` **not** given.

Reproduction (before the fix):

```
resolved (allow_private=False): [('8.8.8.8', True), ('192.168.10.5', False)]
-> connect_first() has no policy check and WILL try 192.168.10.5
```

**Fix:** non-global addresses are now **removed** from the candidate list at
resolution time, so they can never be dialled.  `connect_first()` only ever
sees addresses that passed the policy.

**Regression test:** `tests/test_normalize.py::TestResolveHostPolicy`
(4 cases).

### F-04 — Arbitrary file read through `ca_bundle` *(MEDIUM, fixed)*

**Before:** the web endpoints accepted `ca_bundle=<path>` from the query
string and passed it straight to `validate_ca_bundle()`, which opened any
readable file.  The error messages differentiated "not a readable file" from
"does not contain a PEM certificate", which is a **file-existence oracle**,
and a readable PEM anywhere on the filesystem could be injected as the trust
anchor.

Reproduction (before the fix):

```
/etc/hosts                             -> rejected: does not contain a PEM certificate
/etc/ssl/certs/ca-certificates.crt       -> ACCEPTED
/proc/self/environ                       -> rejected
```

**Fix:** the web layer now resolves the path and requires it to live inside
the application directory (or a directory listed in
`OOKLA_TESTER_ALLOWED_CA_DIRS`).  The **CLI is unaffected**: there the path
comes from the user's own command line and the process already runs with the
user's privileges.

**Regression test:** `tests/test_security.py::TestCaBundleRestriction`
(5 cases) and `::TestWebApiHardening::test_ca_bundle_outside_application_is_refused`.

### F-05 — Socket leak on error paths *(MEDIUM, fixed)*

**Before:** `raw_http()`, `netgauge_check()`, `websocket_check()` and
`keepalive_check()` closed their socket only on the happy path.  A server that
answered with garbage, reset the connection or truncated a body leaked the
socket.  A remote target could therefore accumulate file descriptors in the
tester process.

Detected by running the suite with `-W error::ResourceWarning`, which turned
the leak into a test failure:

```
ResourceWarning: unclosed <socket.socket fd=5, family=2, type=1, ...>
```

**Fix:** every socket is now released in a `finally` block.

**Regression test:** the whole suite runs under `-W error::ResourceWarning`
and `tests/test_protocol.py::TestMalformedServer` exercises the three
failure modes.

### F-06 — No global time budget *(MEDIUM, fixed)*

**Before:** `run_all_tests()` had no overall deadline.  The individual socket
timeouts (6–20 s) bounded each probe, but a run could still take minutes, and
the web server spawns a thread per request — so a handful of concurrent
requests could exhaust threads and file descriptors.

**Fix:** a global budget (`--timeout`, default 180 s) is implemented with a
`contextvars.ContextVar`, so it is per-request and thread-safe.  Every socket
timeout is clamped to the remaining budget, and checks that would start after
the budget is gone are reported as `FAILED` with
`details : Not attempted / error : global test deadline exceeded`.

**Regression test:** `tests/test_protocol.py::TestDeadline` uses a fake server
that delays every response by 5 s and asserts that a 2 s budget ends the run.

### F-07 — Oversized request bodies silently truncated *(LOW, fixed)*

**Before:** `do_POST()` read `min(length, 16384)` bytes and parsed those.  A
larger body was truncated silently, which could cut a legitimate value and
produced a confusing error.  **Fix:** a body above the limit is rejected with
**413**.

### F-02 — IPv6 authority was malformed *(LOW, fixed)*

**Before:** the `Host` header and the generated URLs for an IPv6 literal were
built as `::1:8080` instead of `[::1]:8080`.  **Fix:** `host_header_for()` and
`url_for()` bracket IPv6 literals.  *(See `FINDINGS.md` for the canonical
numbering of every finding.)*

### F-12 — No `X-Content-Type-Options` header *(LOW, fixed)*

The web responses now carry `X-Content-Type-Options: nosniff`, so a browser
cannot be talked into interpreting the JSON endpoint as something else.

---

## 3. Controls that were audited and found **adequate**

| Control | Verdict |
| --- | --- |
| TLS verification is never disabled | **Adequate.** `https_check()` always uses `ssl.create_default_context()` (or `cafile=`).  The single unverified context is used for the *diagnostic* `insecure_response` line inside an already-`FAILED` row and for reading the peer certificate; neither can produce a `PASSED`.  Regression test: `tests/test_security.py::TestTlsVerificationIsNeverDisabled`. |
| Certificate hostname matching | **Adequate.** `server_hostname=host` is always passed, so Python performs the check.  A wrong-host certificate is rejected (negative certificate `wronghost.crt`). |
| Command injection | **Not applicable.** No subprocess is started by the application; the laboratory scripts use fixed argument lists and never interpolate user input into a shell. |
| Path traversal in the application | **Fixed** (F-04).  `restrict_ca_path()` resolves the path before comparing it with the allowed roots. |
| Redirect following | **Not applicable.** The client never follows HTTP redirects; the response is parsed as-is. |
| Unsafe file writes | **Not applicable to the service.** The CLI's `--output` writes a file the user named explicitly, with parent directories created on purpose. |
| Excessive payload allocation | **Bounded.** Response bodies are capped (`body_limit`), the upload body is a fixed size, and the total run is bounded by the global budget. |
| CSRF | **Acceptable by design.** The original page has no CSRF token and the action is a read-only diagnostic against a third-party host.  The clone does not invent a token that the original lacks, because the 1:1 form contract is a hard requirement of the submission. |
| Secret exposure | **Adequate.** No credentials exist in the code.  The repository `.gitignore` and `arena.ai/.gitignore` exclude `*.key`, `*.csr`, `*.pem` (with explicit exceptions for the public certificates) and the proprietary binaries.  `tests/test_security.py::TestNoSecretsInSource` fails the build if a private key appears in a source file. |
| Proprietary binaries in the repository | **Fixed.** The official OoklaServer daemon, its aarch64 build, both tarballs and the Speedtest CLI are **no longer tracked**; `lab/scripts/download-official.sh` downloads and hash-verifies them. |
| Third-party supply chain | **Fixed.** The previous laboratory depended on a 95 MB archive fetched from an unrelated third-party mirror.  The laboratory is now self-contained. |
| Loopback access | **Deliberate and gated.** Loopback and RFC1918 targets require the explicit `--allow-private` / `allow_private=1` flag, and the web form does not expose it. |
| Isolation of the laboratory | **Verified.** The daemon binds `127.0.0.1` only; `enableAutoUpdate` and `useLetsEncrypt` are off; the name redirection is temporary and restored by an `EXIT` trap; the result-submission endpoint is redirected to a local stub that refuses the upload. |

---

## 4. Residual risks (accepted, documented)

| Risk | Why it is accepted | Mitigation / note |
| --- | --- | --- |
| The service is an **open diagnostic proxy**: anyone who can reach port 3000 can make it probe an arbitrary public host | it is the purpose of the tool | private targets are blocked by default; the web form does not expose `allow_private`; the global budget bounds the cost |
| The service can still be used to make **outbound connections to any public host** (port scanning by timing) | inherent to a host tester | no authentication, no rate limit — **if this were deployed publicly a token bucket and an allow-list would be required.**  Recommended before production exposure. |
| The `allow_private` query parameter is reachable on the web endpoint | needed for laboratory use | it is opt-in and documented; in a public deployment it should be removed entirely |
| The daemon serves plain HTTP **and** HTTPS on the same port | official behaviour of OoklaServer | the clone always probes TLS separately, so an insecure configuration is still visible as a `FAILED` `https` row when the certificate is not trusted |
| Loopback benchmarks are meaningless as internet measurements | — | stated in the results and in the README; never presented as capacity |

## 5. Concrete commands to re-run the security checks

```bash
sh tests/run_tests.sh                     # all four suites
python3 -W error::ResourceWarning tests/test_protocol.py    # leak detector
grep -rn "BEGIN .*PRIVATE KEY" arena.ai/ --exclude-dir=.git   # must be empty
git ls-files arena.ai | grep -E '\.(tgz|key)$'               # must be empty
```
