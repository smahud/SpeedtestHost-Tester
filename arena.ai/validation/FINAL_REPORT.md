# FINAL_REPORT.md — independent re-audit of the Ookla Server Tester clone

**Subject:** `arena.ai/` in `https://github.com/smahud/SpeedtestHost-Tester`
**Baseline commit:** `eab16976a4dbf48f36b0d81da5413cf2860e3cfa`
**Audit branch:** `audit/arena-official-validation`
**Date:** 2026-11-04 (Asia/Jakarta)
**Verdict:** **CONDITIONAL PASS**

---

## 1. Executive summary

The submission was re-audited from scratch against the **genuine official
OoklaServer 2.11.5.2 daemon** and the **genuine official Speedtest CLI
1.2.0.84**, with no reliance on the previous session's claims.

| Outcome | |
| --- | --- |
| Findings raised | **22** (1 HIGH, 10 MEDIUM, 11 LOW) |
| Findings fixed | **22 / 22** — each with a regression test |
| Findings still open | **0** |
| Regression suite | **77 tests, 77 passing** |
| Host Tester vs the official daemon | **19 PASSED / 0 FAILED**, exit 0 |
| Official CLI vs the official daemon | **exit 0** (both daemon modes), `server.ip = 127.0.0.1`, `persisted: false` |
| Laboratory measurements published | **none** — the upload was intercepted locally and refused with HTTP 503 |
| Proprietary binaries in the repository | **removed** (downloaded + SHA-256-verified instead) |
| External third-party dependency in the laboratory | **removed** |

Two lab defects were found and fixed while re-running the experiments: the
**isolated** scope of the CLI cross-validation never actually started its
control-plane stub (`sudo` cannot run inside a user namespace), so it failed
with `Network is Unreachable` instead of the documented `LICENSE_ERROR`; and
**two daemon instances could share port 8080** (`SO_REUSEPORT`), which made
measurements non-deterministic.  Both are fixed and the corrected runs are the
ones recorded here.

The previous session's central claims were **re-derived and confirmed**:
the daemon serves HTTP/HTTPS/NetGauge/WebSocket on one port, the ten legacy
image sizes are exact, the daemon's upload algorithm returns the raw
`Content-Length`, and the official CLI really does complete a full benchmark
against a local daemon.  The audit additionally found and fixed a set of
defects that the previous session could not see, because it had no
regression suite and relied on a third-party simulator for the legacy
behaviour.

**CONDITIONAL PASS** means: the implementation is correct, secure and
independently reproducible **as a local diagnostic tool**, and the remaining
conditions are the ones that cannot be closed from inside the sandbox — the
official backend is closed behind reCAPTCHA, a public deployment of the web
endpoint needs an access-control layer that a local tool does not need, and
the GitHub push is blocked by the absence of a write credential.

---

## 2. The mandated A–K checklist

### A — Workspace isolation

**Met.**

| Requirement | Evidence |
| --- | --- |
| everything inside `arena.ai/` | the laboratory, tests, scripts, certificates, artefacts and documents live under `arena.ai/`; `git status` shows only `arena.ai/` paths changed |
| no other agent's directory touched | `git diff --name-only` against the baseline lists only `arena.ai/…`; `chatgpt/`, `mistral.ai/` and `z.ai/` were read at most |
| no machine-wide change left behind | the `/etc/hosts` redirection used by the CLI cross-validation is removed by an `EXIT` trap and verified afterwards (`OK: no lab entries left in /etc/hosts`) |
| no global trust-store change | the laboratory CA is passed per process (`--ca-bundle` / `cafile=`), never installed system-wide |
| the daemon is isolated | bound to `127.0.0.1:8080` only; `enableAutoUpdate = false`; `useLetsEncrypt = false` |

**Declared deviation.** The official-CLI cross-validation needs the CLI to
resolve `myspeed.gorge.net` to the laboratory daemon, and `mount` is blocked
inside a user namespace in this sandbox (`mount --bind` → *permission
denied*), so a namespaced `/etc/hosts` is impossible.  The experiment
therefore adds temporary `127.0.0.1` entries through `sudo -n`, always
removing them with a shell `trap` on exit, and a network namespace still
guarantees that no traffic can leave the host.  The fully isolated variant
exists and runs, but ends in the documented `LICENSE_ERROR`.

### B — Scope compliance

**Met.** Every step of the brief was executed: the initial mandatory audit of
`arena.ai/` (structure, source, configuration, tests, protocol handling,
dependencies, security, error handling, documentation, prior results, gaps —
all recorded in `CONTEXT_BASELINE.md` §2), the defect cycle, the three-way
validation, the security review and the delivery.

### C — Findings

**Met.** 20 findings, each with OBSERVE → REPRODUCE → ROOT CAUSE → FIX →
REGRESSION → OFFICIAL VALIDATION → REVIEW: `FINDINGS.md`.

The previous session's claims were classified as **VERIFIED**,
**PARTIALLY VERIFIED** or **NOT INDEPENDENTLY VERIFIABLE** — never simply
repeated: `FINDINGS.md` §"Prior claims, re-evaluated".

### D — Official binary validation

**Met.** The daemon and the CLI were downloaded from the official URLs,
**SHA-256-verified**, and their versions recorded
(`2.11.5.2` / `1.2.0.84`).  The upstream artefacts were re-fetched on
2026-11-04 and are byte-identical to the ones used earlier.
Manifests: `lab/binaries/MANIFEST.md`, `lab/cli/MANIFEST.md`.
The binaries are **not committed**; `lab/scripts/download-official.sh`
re-fetches and re-verifies them.

### E — Cross-validation

**Met.** The official CLI ran a full benchmark against the official daemon
(exit 0) in both daemon modes, with the target-selection method documented
(→ `cli.speedtest.net/api/cli/config` → server list → `myspeed.gorge.net:8080`
→ redirected to `127.0.0.1`).  Versions, destination, exit code, logs,
latency, down/up, packet loss, TLS outcome and errors were captured:
`CROSS_VALIDATION.md`.

### F — Code improvements

**Met.** `app.py` and `cli.py` raised to **v1.3.0**:

* the URL scheme now selects the transport (`https://` → TLS), with
  `--daemon-tls` / `--no-daemon-tls` overrides;
* a global, thread-safe run budget (`--timeout`, default 180 s);
* an SSRF fix — non-global addresses are removed at resolution time;
* a CA-path restriction for the web layer (`restrict_ca_path()`);
* an O(n) response reader instead of the quadratic one;
* strict WebSocket header parsing instead of a substring match;
* a pure-Python X.509 description instead of `ssl._ssl._test_decode_cert()`
  and a temporary file;
* correct IPv6 authority handling;
* socket leaks closed on every error path;
* a 16 KB request-body cap with HTTP 413, `nosniff`, and a generic 500.

### G — Security

**Met.** `SECURITY_AUDIT.md` — threat model, per-finding analysis, the
controls that were audited and found adequate, and the **residual risks that
are accepted** (open diagnostic proxy, no rate limiting, no CSRF token
because the original form has none).

### H — Test results

**Met.** 77 tests in four suites (`tests/run_tests.sh`), plus the
eight-variant matrix against the genuine daemon, plus the official-CLI
cross-validation, plus the raw daemon probe.  Every number in
`TEST_MATRIX.md` is a measured outcome.

### I — Documentation links

**Met.** `validation/` contains the eleven mandated documents, each with
FACT / OBSERVATION / ASSUMPTION / HYPOTHESIS / DECISION / OPEN QUESTION
labels.  `README.md`, `AUDIT.md` and `SIMULASI-OOKLASERVER.md` link into it
and no longer point at the removed `ooklaserver/sim/` tree.

### J — Git delivery

**Partially met — the push is blocked by the environment, not by the work.**

| Requirement | State |
| --- | --- |
| dedicated branch | ✅ `audit/arena-official-validation` |
| only `arena.ai/` paths staged/committed | ✅ verified: `git show --name-only --format= HEAD` lists no path outside `arena.ai/` |
| commit created | ✅ `c9fd87e5e65ad949be0fe417542d5a8e46a8e888` |
| never force-pushed | ✅ |
| other agents' branches/worktrees untouched | ✅ (`audit/z-ai-official-validation` and `main` are as they were) |
| **pushed to the remote** | ❌ **blocked** — the sandbox has no GitHub credentials |
| PR opened | ❌ not possible for the same reason |

```
$ git push -u origin audit/arena-official-validation
fatal: could not read Username for 'https://github.com': No such device or address
```

`github.com` itself is reachable (HTTP 200) and the repository is clonable
anonymously; only the write credential is missing.  The branch therefore
exists **locally and is ready to push**; from a machine with credentials:

```bash
git push -u origin audit/arena-official-validation
```

Two verified transfer artefacts are produced for that case
(`lab/results/delivery/`, not committed because they are large and
redundant with the branch): a `git bundle` carrying the full branch history
and a `git format-patch` of the audit commits against the baseline.  The
bundle was also delivered out-of-band to Google Drive (folder
*“SpeedtestHost-Tester — arena.ai official validation (audit 2026-11-04)”*);
the Drive connector's security filter refused the `.patch` and
`FINAL_REPORT.md` uploads, which is recorded here rather than worked around
— the bundle contains both files in full.

### K — Production readiness

**CONDITIONAL PASS.** See §3.

---

## 3. Production readiness

### 3.1 What is production-ready

* the CLI (`host-tester`) — a self-contained, stdlib-only diagnostic tool;
* the engine — deterministic, bounded by a global timeout, leak-free;
* the TLS posture — verification is never disabled and an untrusted chain is
  always a `FAILED` row;
* the documentation set — every claim is traceable to an artefact.

### 3.2 The conditions

| # | Condition | Why it cannot be closed here |
| --- | --- | --- |
| C-1 | the web endpoint needs authentication and rate limiting before it is exposed to an untrusted network | a local diagnostic has no session model, and the 1:1 form contract forbids inventing one |
| C-2 | the `allow_private` parameter should be removed from the web endpoint in a public deployment | it exists for laboratory use; the decision is the deployment's |
| C-3 | equivalence with Ookla's own result page is unproven | the official backend is behind reCAPTCHA and was **not** bypassed |
| C-4 | Ookla's regional watchdogs may disagree with a single-sandbox result | inherent; the result page says so (`runner_note`) |

### 3.3 What is explicitly *not* claimed

* not "1:1 with Ookla's backend" — the official implementation is closed;
* not "zero defects" — 22 defects existed and were found by this audit; a
  further independent audit may find more;
* not "officially certified by Ookla" — nothing of the kind was obtained;
* not "the CLI's loopback numbers show internet capacity" — they do not;
* not "the official tester probes UDP" — unknown, and a UDP probe would
  produce false failures against this daemon.

---

## 4. Delivery

| Item | Value |
| --- | --- |
| Branch | `audit/arena-official-validation` |
| Baseline | `eab16976a4dbf48f36b0d81da5413cf2860e3cfa` |
| Audit commit | `c9fd87e5e65ad949be0fe417542d5a8e46a8e888` |
| Committed paths | `arena.ai/` only — verified with `git show --name-only --format= HEAD` |
| Force-push | never used |
| Other agents' files | not modified, not staged, not reset |
| Remote push | **blocked** — no GitHub credential in the sandbox (`lab/results/delivery/README.md` has the exact command and two verified transfer artefacts) |
| PR | not possible for the same reason |

The tested commit and the committed commit are the same object:
`c9fd87e5e65ad949be0fe417542d5a8e46a8e888` was the tree that the 77-test
suite, the eight-variant matrix, the 19/19 run and the three CLI
cross-validation scopes were executed against.

---

## 5. The ten sentences to remember

1. The clone scores **19/19** against the **genuine** official OoklaServer
   2.11.5.2 daemon — no simulator in the loop.
2. The official Speedtest CLI also ran against that same daemon: **exit 0**,
   `server.ip = 127.0.0.1`.
3. **No laboratory measurement was published** — the result upload was
   intercepted locally and refused with HTTP 503 (`persisted: false`).
4. The audit found and fixed **22 defects**, including a real SSRF policy
   bypass, a socket leak on every error path and two laboratory defects
   that made measurements non-deterministic.
5. The regression suite (**77 tests**) is green and leak-free under
   `-W error::ResourceWarning`.
6. The official binaries are **no longer in the repository**; they are
   downloaded and SHA-256-verified.
7. The laboratory no longer depends on any third-party mirror.
8. The official daemon serves **plain HTTP, HTTPS, raw NetGauge and WSS on
   one port**, and **does not answer UDP** — so there is deliberately no UDP
   check.
9. The upload algorithm differs between the legacy PHP endpoint and the
   daemon; both are supported and the detected mode is reported.
10. The official `/host-tester` backend and result page remain closed
    behind reCAPTCHA — that is the boundary of what any honest audit can
    prove.
