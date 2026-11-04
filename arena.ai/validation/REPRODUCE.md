# REPRODUCE.md — how to repeat every experiment

Every path below is relative to the repository root and **everything happens
inside `arena.ai/`**.  The commands need no network access except for the
official-binary download (step 1) and the official-CLI control plane (step 6).

```bash
cd arena.ai
```

---

## 0. Prerequisites

| Requirement | Version used |
| --- | --- |
| Python | 3.13 (standard library only) |
| OpenSSL CLI | 3.5.7 (only for the certificate cross-checks) |
| `sudo -n` | required **only** for the official-CLI cross-validation (step 6) |
| `unshare -rn` | optional; used for the isolated variant of step 6 |

Ports used by the laboratory: **8080** (daemon), **80** (legacy control),
**443** (CLI control-plane stub), **3000** (the clone's web server).

---

## 1. Official binaries (download + hash verification)

```bash
sh lab/scripts/download-official.sh
```

Expected output ends with:

```
  ok  ookla-speedtest-1.2.0-linux-x86_64.tgz  5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7
  ok  speedtest  31f1124c5ab8acdae6b9fe1741e704df420f9f2e7d429679fabe62075453c051
versions:
2.11.5.2 2026-06-04.1737.7d0993d
Speedtest by Ookla 1.2.0.84 (ea6b6773cf) Linux/x86_64-linux-musl 6.1.189+ x86_64
```

The script exits non-zero and deletes nothing if any checksum differs.

## 2. Laboratory PKI

```bash
sh lab/scripts/make-certs.sh
```

Creates `lab/certs/{ca.crt,ca.key,server.crt,server.key,fullchain.pem,
untrusted.crt,expired.crt,wronghost.crt,control.crt,control.key,
ca-bundle-cli.pem}`.  `ca.key`, `server.key` and `control.key` are **never
committed**.

## 3. Start the official daemon (port 8080 only)

```bash
sh lab/scripts/start-daemon.sh http     # plain HTTP on 8080
sh lab/scripts/start-daemon.sh https    # TLS + plain on the same 8080
sh lab/scripts/stop-daemon.sh
```

Verify:

```bash
curl -s http://127.0.0.1:8080/hi; echo
# hello 2.11 (2.11.5) 2026-06-04.1737.7d0993d
```

## 4. Probe the daemon directly (no clone code involved)

```bash
python3 lab/scripts/probe-daemon.py --out lab/results/probe-http.json
python3 lab/scripts/probe-daemon.py --tls --ca lab/certs/ca.crt \
        --out lab/results/probe-https.json
```

The probe covers the NetGauge handshake, the HTTP endpoints, the upload size
algorithm, the ten image sizes, the WebSocket upgrade, keep-alive and the UDP
behaviour.

## 5. Run the Host Tester against the official daemon

```bash
# TLS mode, laboratory CA trusted
python3 cli.py localhost:8080 \
    --allow-private --ca-bundle lab/certs/ca.crt \
    --legacy-port 8080 --upload-mode auto --json -q

# the same run with the scheme selecting TLS
python3 cli.py 'https://localhost:8080' \
    --allow-private --ca-bundle lab/certs/ca.crt --legacy-port 8080

# negative controls
python3 cli.py localhost:8080 --allow-private --legacy-port 8080   # 18/1 (untrusted TLS)
python3 cli.py localhost:8080 --allow-private --ca-bundle lab/certs/untrusted.crt \
    --legacy-port 8080                                              # 18/1
python3 cli.py localhost:8080 --allow-private --ca-bundle lab/certs/ca.crt \
    --legacy-port 80 --upload-mode legacy                           # 4/15
```

The whole variant matrix:

```bash
sh lab/scripts/run-variants.sh        # -> lab/results/variants/
```

## 6. Official Speedtest CLI ↔ official OoklaServer

```bash
sh lab/scripts/cross-validate-cli.sh https real       # TLS daemon, genuine control plane
sh lab/scripts/cross-validate-cli.sh http  real       # plain daemon
sh lab/scripts/cross-validate-cli.sh https isolated   # network namespace, stubbed control plane
```

* `real` redirects `myspeed.gorge.net` and `results.speedtest.net` to
  `127.0.0.1` in `/etc/hosts` and restores the file with an `EXIT` trap.
* `isolated` runs everything inside `unshare -rn`; it exits **2** with
  `LICENSE_ERROR` (documented limitation).
* The run ends with `OK: no lab entries left in /etc/hosts`.

Artefacts: `lab/results/cli-cross-validation-{https,http}-real.{json,log}`,
`lab/results/cli-cross-validation-https-isolated.log` and
`lab/results/cli-stub-state.json`.

## 7. Regression suite

```bash
sh tests/run_tests.sh
```

Expected:

```
test_normalize ................. 21 tests  OK
test_protocol .................. 27 tests  OK
test_security .................. 20 tests  OK
test_integration_official ......  9 tests  OK
ALL REGRESSION TESTS PASSED
```

With the leak detector enabled:

```bash
python3 -W error::ResourceWarning tests/test_protocol.py
```

The integration suite is skipped automatically when no daemon is reachable
(`SKIP: official daemon not reachable on 127.0.0.1:8080`).

## 8. The web application

```bash
PORT=3000 python3 app.py
```

* `http://127.0.0.1:3000/host-tester` — the form
* `http://127.0.0.1:3000/host-tester?run=1&host=127.0.0.1:8080&allow_private=1&ca_bundle=lab/certs/ca.crt&legacy_port=8080`
  — the result page
* `http://127.0.0.1:3000/api/test?host=…` — the JSON API

## 9. Reproducing a single finding

| Finding | Command |
| --- | --- |
| F-01 quadratic body | `python3 -c "import time,app; …"` — see `tests/test_security.py::test_read_body_is_linear` |
| F-03 SSRF | `python3 -m unittest tests.test_normalize -k ResolveHostPolicy` |
| F-04 file read | `python3 -m unittest tests.test_security -k CaBundleRestriction` |
| F-05 socket leak | `python3 -W error::ResourceWarning tests/test_protocol.py` |
| F-06 deadline | `python3 -m unittest tests.test_protocol -k Deadline` |
| F-08 WebSocket | `python3 -m unittest tests.test_protocol -k WebSocket` |
| F-09 scheme | `python3 -m unittest tests.test_protocol -k SchemeSelectsTransport` |
| F-10 certificate decoding | `openssl x509 -in lab/certs/server.crt -noout -subject -issuer -dates` vs the `certificate` block of the JSON output |
| F-16 proprietary binaries | `git ls-files arena.ai \| grep -E '\.(tgz)$'` → must be empty |

## 10. Housekeeping

```bash
git ls-files arena.ai | grep -E '\.(tgz|key)$'   # must be empty
git grep -n "BEGIN .*PRIVATE KEY" -- arena.ai    # must be empty
```

---

## Known deviations from the "perfect" laboratory

| Deviation | Reason |
| --- | --- |
| the daemon runs directly instead of in a container | `docker` is not installed in the environment |
| the name redirection touches the host `/etc/hosts` instead of a namespaced copy | `mount` is blocked inside a user namespace (`mount --bind` → permission denied); the redirection is temporary, trap-restored and verified |
| the stub needs `sudo` to bind 443 | binding a privileged port as an unprivileged user fails with `EACCES` |
| the isolated variant cannot complete a CLI benchmark | the licence key in the configuration document is bound to the device/ISP context (`LICENSE_ERROR`); the stub itself is reachable and answers the config API with HTTP 200 |
| the legacy control server is a re-implementation, not the official package | the official legacy archive has no stable official URL and is not redistributable; the byte sizes it reproduces were independently confirmed against the genuine daemon |
