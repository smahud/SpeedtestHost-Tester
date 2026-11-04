# HANDOFF.md — continue this work without the original conversation

**Target directory:** `arena.ai/` — **nothing outside it may be executed,
modified or installed into.**
**Audit branch:** `audit/arena-official-validation`
**Baseline commit:** `eab16976a4dbf48f36b0d81da5413cf2860e3cfa`
**Last updated:** 2026-11-04 (Asia/Jakarta)

---

## 0. Read this first — the isolation policy (repeat it verbatim)

> The workspace is a **multi-agent repository**.  Each agent owns one
> directory.  **This agent owns `arena.ai/` and nothing else.**
>
> * Every execution, dependency install, build, test, laboratory service,
>   temporary file, artefact and document must stay **inside `arena.ai/`**.
> * `chatgpt/`, `mistral.ai/` and `z.ai/` are **read-only references**.  They
>   may be *read* to reuse ideas, but their applications and scripts must
>   **never be executed**, their files **never modified, moved, renamed or
>   deleted**, and nothing may be installed into them.
> * Root-level files (`README.md`, `.gitignore`, …) are read-only unless a
>   change is explicitly requested.
> * Only `arena.ai/` files are staged and committed.  Unrelated changes must
>   never be swept into a commit.
> * Never force-push, never reset or discard someone else's work, never
>   modify another branch or worktree, never merge automatically.
> * Borrowed knowledge must be **independently verified and re-implemented**
>   inside `arena.ai/`, with attribution and its own regression evidence.
> * The machine-wide `/etc/hosts`, the global trust store and production
>   network configuration are **not** to be modified unless explicitly
>   authorised.  Use namespace- or process-scoped configuration.
> * Never publish laboratory measurements as genuine public speedtest
>   results, and never present loopback bandwidth as internet capacity.
> * Never claim perfect compatibility, zero defects or "official Ookla
>   certification".  Unresolved criteria are recorded as limitations.

The only sanctioned exception used so far is the **temporary** `/etc/hosts`
entry during the official-CLI cross-validation (see §6); it is always removed
by an `EXIT` trap and verified afterwards.

---

## 1. Where everything is

| Path | What it is |
| --- | --- |
| `app.py` | the engine **and** the web server (stdlib only).  `run_all_tests()` is the shared entry point. |
| `cli.py` | the CLI (v1.3.0); imports `normalize_target`, `detect_scheme`, `format_text`, `run_all_tests` from `app.py` |
| `host-tester` | a two-line `sh` wrapper around `cli.py` |
| `assets/` | `chrome.html`, `form.html`, `inline.css`, `fonts/` — the 1:1 form clone |
| `audit/` | screenshots and computed styles of the original page |
| `tests/` | the regression suite (77 tests) + `run_tests.sh` |
| `lab/` | the laboratory: `binaries/`, `cli/`, `config/`, `certs/`, `scripts/`, `logs/`, `results/`, `runtime/`, `legacy/` |
| `validation/` | the eleven mandated documents |
| `hasil-*` | the saved result artefacts of the submission |
| `AUDIT.md`, `README.md`, `SIMULASI-OOKLASERVER.md` | the submission documentation |

### The laboratory scripts (`lab/scripts/`)

| Script | Purpose |
| --- | --- |
| `download-official.sh` | download + **SHA-256 verify** the daemon and the CLI |
| `make-certs.sh` | generate the laboratory CA, the leaf, three negatives and the control certificate |
| `start-daemon.sh` / `stop-daemon.sh` | run the official daemon on `127.0.0.1:8080` (TCP+UDP) |
| `probe-daemon.py` | probe the daemon **directly**, without any clone code |
| `legacy_control.py` | self-contained legacy fallback control on port 80 |
| `cli_stub.py` | HTTPS control-plane stub; serves the config, **refuses** `/reports` with 503 |
| `cross-validate-cli.sh` | official CLI ↔ official daemon (`real` / `isolated` scopes) |
| `run-variants.sh` | the eight-variant matrix |

All of them derive their paths from `$(dirname "$0")` and work from any
clone location.

---

## 2. The architecture in one paragraph

`app.py` holds a single engine, `run_all_tests(host, options)`, which
produces a list of 19 flat check rows
(`{name, status, details, error, duration_ms, …}`).  The web layer
(`Handler`) and `cli.py` are two renderers of that list.  The engine is
stdlib-only, uses `contextvars` for the per-request deadline, and never
disables TLS verification.

The 19 checks: `netgauge`, `websocket`, `crossdomain`, `https` (daemon port)
plus `crossdomain`, `latency`, `upload`, `max_upload`, `image_sizes` ×10,
`keepalive` (legacy port).

---

## 3. The current state

| Item | State |
| --- | --- |
| official daemon | **running** on `127.0.0.1:8080` (TLS mode); stop it with `sh lab/scripts/stop-daemon.sh` |
| Host Tester vs the official daemon | **19 PASSED / 0 FAILED**, exit 0 (`lab/results/final-hosttester-tls.json`) |
| official CLI ↔ official daemon | **exit 0**, `server.ip = 127.0.0.1`, `persisted: false`, submission refused with 503 (`lab/results/cli-cross-validation-https-real.json`) |
| regression suite | **77/77 passing** (`sh tests/run_tests.sh`) |
| proprietary binaries | **untracked**; re-download with `sh lab/scripts/download-official.sh` |
| `validation/` | **complete** (11 documents) |
| documentation | `README.md` / `AUDIT.md` **still describe the old state** → see §5 |
| `hasil-*` | **still from the previous session** → see §5 |
| git | the work is **staged but not committed** → see §5 |

---

## 4. The facts you must not have to re-derive

* **Baseline SHA** `eab16976a4dbf48f36b0d81da5413cf2860e3cfa`; prior work in
  commits `80cca35`, `59e1944`, `2c49b98`.
* **Daemon version** `2.11.5.2`, build `2026-06-04.1737.7d0993d`.
* **CLI version** `1.2.0.84 (ea6b6773cf)`.
* **Official binary hashes** are in `lab/binaries/MANIFEST.md` and
  `lab/cli/MANIFEST.md`; `download-official.sh` enforces them.
* **The official daemon serves plain HTTP, HTTPS, raw NetGauge TCP and WSS on
  port 8080 simultaneously**, and binds UDP 8080 **without** answering a
  NetGauge datagram → the implementation deliberately has **no UDP check**.
* **The ten official image byte sizes** are in `validation/PROTOCOL_MATRIX.md`
  §5 and are re-produced by `lab/scripts/legacy_control.py`.
* **The daemon's `upload.php` returns the raw `Content-Length`**; the legacy
  PHP endpoint returns `500 + Σ(len(key)+len(value)+3)`.  Both are supported;
  `--upload-mode auto` detects and reports which one matched.
* **The official CLI licence key is bound to the device/ISP context** → a
  captured configuration document can never satisfy the CLI's licence check,
  so the `isolated` scope exits 2.  This is a **documented limitation**, not a
  bug to be chased.  The stub itself *is* reached in that scope (it answers
  the config API with HTTP 200) — the failure comes after that.
* **`sudo` does not work inside `unshare -rn`** (`sudo: unable to open
  /etc/sudoers`).  Inside the namespace the process is uid 0 with full
  capabilities, so the stub binds port 443 unprivileged there; outside it
  needs `sudo -n`.  The cross-validation script picks the right one per scope.
* **OoklaServer binds with `SO_REUSEPORT`** → two daemons silently share
  port 8080 and the kernel distributes connections between them, which makes
  every measurement non-deterministic.  `start-daemon.sh` now refuses to
  start when 8080 is taken, and `cross-validate-cli.sh` stops any running
  daemon first.
* **The CLI's `--ca-certificate` replaces the trust store** (it does not
  extend it) — identical to `--ca-bundle`.
* **Loopback throughput (10–12 GB/s) is not internet capacity** and must
  never be presented as such.

---

## 5. What is still open

1. **Commit and push** the work on `audit/arena-official-validation`.
   * Stage **only** `arena.ai/` paths.
   * Verify with `git diff --cached --name-only` that nothing outside
     `arena.ai/` is staged.
   * Push with **no force**; open a PR if the remote allows it.
   * Confirm `git rev-parse HEAD` equals the pushed commit.
2. ~~**Regenerate `hasil-*`**~~ — done: `python3 lab/scripts/regenerate-hasil.py`
   rewrote them against the laboratory daemon (19/19).
3. ~~**Update `README.md` and `AUDIT.md`**~~ — done: both now describe
   v1.3.0, the `lab/` layout and the `validation/` set.
4. ~~**`SIMULASI-OOKLASERVER.md`**~~ — rewritten as a pointer to
   `validation/` and `lab/`.
5. **Optional:** extend the variant matrix with a `--timeout` exhaustion case
   and a concurrency case (many parallel web requests).

---

## 6. How to restart the laboratory from scratch

```bash
cd arena.ai
sh lab/scripts/download-official.sh
sh lab/scripts/make-certs.sh
sh lab/scripts/start-daemon.sh https
python3 lab/scripts/probe-daemon.py --tls --ca lab/certs/ca.crt --out lab/results/probe-https.json
python3 cli.py localhost:8080 --allow-private --ca-bundle lab/certs/ca.crt \
        --legacy-port 8080 --upload-mode auto --json -q
sh tests/run_tests.sh
```

The daemon is a foreground process managed by `start-daemon.sh` /
`stop-daemon.sh`; it never forks and never auto-updates.

---

## 7. Traps

* **Do not** run the CLI cross-validation without reading
  `lab/scripts/cross-validate-cli.sh` — it edits `/etc/hosts` through
  `sudo -n`.  Always keep the `EXIT` trap intact.
* **Do not** `pkill -f cli_stub.py` — the pattern matches the calling shell
  and kills it.  Use the stub's `--pidfile`.
* **Do not** leave two daemons running: OoklaServer uses `SO_REUSEPORT`, so
  the second instance shares port 8080 with the first and the results become
  random.  `sh lab/scripts/stop-daemon.sh` before starting a new one.
* **Do not** start a second stub on port 443; it fails with `EACCES` unless
  it runs under `sudo -n`.
* **Do not** use `mount` inside `unshare -rn` — it is denied in this sandbox.
* **Do not** delete `lab/certs/*.key` — they are regenerated by
  `make-certs.sh` but are not committed; a fresh clone must run that script
  first.
* **Do not** commit the tarballs, the extracted binaries or the `*.key`
  files.  `arena.ai/.gitignore` enforces it; the pre-commit check is
  `git ls-files arena.ai | grep -E '\.(tgz|key)$'` → must be empty.
* **Do not** present the loopback figures as internet throughput.
* The root `.gitignore` excludes `*.pem` except a few historic paths; the
  nested `arena.ai/.gitignore` overrides it and explicitly re-includes the
  public certificates (`ca.crt`, `server.crt`, `fullchain.pem`, `control.crt`,
  `ca-bundle-cli.pem`).

---

## 8. Where the evidence lives

| Question | File |
| --- | --- |
| what the server actually does | `validation/PROTOCOL_MATRIX.md` |
| every test that was run | `validation/TEST_MATRIX.md` |
| CLI ↔ daemon ↔ tester | `validation/CROSS_VALIDATION.md` |
| security | `validation/SECURITY_AUDIT.md` |
| the defects and their fixes | `validation/FINDINGS.md` |
| why things are the way they are | `validation/DECISIONS.md` |
| how to re-run everything | `validation/REPRODUCE.md` |
| the bottom line | `validation/FINAL_REPORT.md` |
| the raw artefacts | `lab/results/` |
