# Delivery note — arena.ai independent re-audit (2026-11-04)

**Repository:** `https://github.com/smahud/SpeedtestHost-Tester`
**Target directory:** `arena.ai/` (this agent's directory — nothing else was executed or modified)
**Baseline commit:** `eab16976a4dbf48f36b0d81da5413cf2860e3cfa`
**Branch:** `audit/arena-official-validation`
**Audit commits:** `c9fd87e` (the work) + `e4174c3` (the delivery note)

---

## 1. The work is on GitHub — PR #1

| Item | Value |
| --- | --- |
| Branch | `audit/arena-official-validation` |
| Remote tip | `d6c380351a43046578237218b020ff6c3db220a1` (= local `HEAD`) |
| Pull request | **#1** — https://github.com/smahud/SpeedtestHost-Tester/pull/1 |
| Base | `main` (untouched, still `eab16976a4dbf48f36b0d81da5413cf2860e3cfa`) |
| Other agents' branches | untouched (`origin/audit/z-ai-official-validation` still `f0f3f0e`) |
| Files touched outside `arena.ai/` | **none** |
| Force-push | never used |
| Token in `.git/config` / tracked files / working tree | **absent** (verified) |

The push used the repository owner's fine-grained PAT through a transient
credential helper, so nothing was persisted:

```bash
GIT_TERMINAL_PROMPT=0 git \
  -c credential.helper='!f() { echo username=x-access-token; echo "password=$GH_PAT"; }; f' \
  push -u origin audit/arena-official-validation
```

This bundle remains available as an offline copy of the same history:

```bash
git clone arena-official-validation.bundle work
cd work
git checkout audit/arena-official-validation
```

## 2. What is in this folder

| File | Size | Content |
| --- | ---: | --- |
| `arena-official-validation.bundle` | 19 543 592 B | the complete branch history (`git bundle verify` reports *a complete history*) |
| `arena-official-validation.patch` | — | **not uploaded** — the Drive connector's security filter blocked the file; the bundle already contains the same content, so nothing is lost |

Two further uploads were refused by the connector's security filter
(`arena-official-validation.patch` and `validation/FINAL_REPORT.md`); they
were **not** altered to get past the filter.  The bundle contains the full
content of both, because they are ordinary tracked files of the branch.

## 3. Headline results

| Check | Result |
| --- | --- |
| Host Tester vs the **genuine** official OoklaServer `2.11.5.2` | **19 PASSED / 0 FAILED**, exit 0 |
| Official Speedtest CLI `1.2.0.84` vs the same daemon | **exit 0**, `server.ip = 127.0.0.1`, `persisted: false` |
| Laboratory measurement published? | **no** — the upload was intercepted locally and refused with HTTP 503 |
| Findings raised / fixed | **22 / 22** |
| Regression suite | **77 tests, all passing**, leak-free under `-W error::ResourceWarning` |
| Proprietary binaries in the repository | **removed** (downloaded + SHA-256-verified instead) |
| Third-party mirror in the laboratory | **removed** (self-contained control server) |
| Files touched outside `arena.ai/` | **none** |

## 4. The documentation set

Everything is under `arena.ai/validation/` — eleven documents:

`CONTEXT_BASELINE.md` · `ENVIRONMENT.md` · `PROTOCOL_MATRIX.md` ·
`TEST_MATRIX.md` · `CROSS_VALIDATION.md` · `SECURITY_AUDIT.md` ·
`FINDINGS.md` · `DECISIONS.md` · `REPRODUCE.md` · `HANDOFF.md` ·
`FINAL_REPORT.md`

Start with `FINAL_REPORT.md` (the A–K checklist and the
CONDITIONAL PASS verdict) and `HANDOFF.md` (for whoever continues the work).

## 5. Reproducing it

```bash
cd arena.ai
sh lab/scripts/download-official.sh     # official binaries, SHA-256 verified
sh lab/scripts/make-certs.sh            # laboratory CA + negative certificates
sh lab/scripts/start-daemon.sh https     # official daemon on 127.0.0.1:8080
python3 cli.py localhost:8080 --allow-private \
        --ca-bundle lab/certs/ca.crt --legacy-port 8080 --upload-mode auto
sh tests/run_tests.sh                   # 77 tests
sh lab/scripts/cross-validate-cli.sh https real   # official CLI ↔ official daemon
```

## 6. Three things not to get wrong

1. **Loopback throughput is not internet capacity.**  The official CLI
   measured 11–12 GB/s over `lo` in the laboratory; that says nothing about
   a real link.
2. **A successful TLS handshake is not a successful certificate
   authentication.**  Verification is never disabled, and an untrusted chain
   always produces a `FAILED` row.
3. **The official `/host-tester` backend was never observed** — it is behind
   reCAPTCHA, and the challenge was not bypassed.  Everything claimed here
   about the *server* comes from the genuine OoklaServer daemon, and
   everything claimed about the *official tester* is labelled
   *not independently verifiable*.
