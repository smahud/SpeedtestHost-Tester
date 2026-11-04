# CROSS_VALIDATION.md — official CLI ↔ official OoklaServer ↔ this Host Tester

**Date:** 2026-11-04 (Asia/Jakarta)
**Binaries:** official Speedtest CLI `1.2.0.84 (ea6b6773cf)`,
official OoklaServer `2.11.5.2 / 2026-06-04.1737.7d0993d`

---

## 1. The experiment

The genuine Speedtest CLI was pointed at the genuine OoklaServer daemon that
runs in the laboratory, and the three participants were compared layer by
layer.

### 1.1 How the CLI is aimed at the laboratory daemon

The CLI resolves a server by FQDN, so the laboratory server name is mapped to
the loopback address:

```
127.0.0.1   myspeed.gorge.net        # the Ookla server that the CLI must reach
127.0.0.1   results.speedtest.net    # the result-submission endpoint (see 1.3)
```

`myspeed.gorge.net` is server id **4063** in the genuine Ookla server list
(`https://cli.speedtest.net/api/cli/config`), port **8080** — the same
default port the clone uses.

### 1.2 What was redirected, and what was not

| Name | Redirected? | Reason |
| --- | --- | --- |
| `myspeed.gorge.net` | **yes** → `127.0.0.1` | this is the server under test; it must be the laboratory daemon |
| `results.speedtest.net` | **yes** → `127.0.0.1` | the result-submission endpoint, so that **no laboratory measurement can be published** (§7 of the audit brief) |
| `cli.speedtest.net` | no | the genuine configuration API must answer, because the licence key it issues is bound to the device and the detected ISP |
| `www.speedtest.net` | no | used by the CLI for ISP/interface detection |
| every other host | no | untouched |

`/etc/hosts` is restored by an `EXIT` trap; the run ends with
`grep 'arena-lab' /etc/hosts` returning nothing (verified).

### 1.3 Why the submission endpoint is redirected

The CLI uploads the measurement to `https://results.speedtest.net/reports`.
A loopback benchmark is **not** a genuine internet measurement, so publishing
it would be a false public record.  A local stub
(`lab/scripts/cli_stub.py`) therefore listens on `127.0.0.1:443` with a
certificate for `results.speedtest.net` signed by the laboratory CA, records
the upload and answers **HTTP 503**.

Observed evidence:

```
[info] HTTP request (effective url: https://results.speedtest.net/reports) completed with response code 503
"result": { "id": "aaa2dbd4-4b74-4667-83c7-d4f42c2c9c82", "persisted": false }
```

and the stub state (`lab/results/cli-stub-state.json`):

```json
{ "submissions": [ { "path": "/reports", "length": 135040,
                     "sha256_prefix": "438d600d8608899d", ... },
                   { "path": "/reports", "length": 139208,
                     "sha256_prefix": "2e238d041ee9561e", ... } ],
  "config_requests": [] }
```

(The state file accumulates across runs: two runs — one per daemon mode —
were recorded, each refused with HTTP 503.)

The upload **was** attempted (198 076 bytes) and **was** refused locally.
`persisted: false` in the CLI's own JSON is the authoritative confirmation.

### 1.4 The fully isolated variant

`sh lab/scripts/cross-validate-cli.sh https isolated` runs the whole
experiment inside `unshare -rn`, a network namespace with nothing but
loopback, and replaces the control plane with a local stub that serves a
captured configuration document.

Inside the namespace the process is uid 0 with a full capability set over
that namespace, so the stub can bind the privileged port 443 **without**
`sudo` — and `sudo` in fact cannot run there at all (`sudo: unable to open
/etc/sudoers`), which is why the script starts the stub unprivileged in this
scope and with `sudo -n` in the `real` scope.

Measured result (artefact `lab/results/cli-cross-validation-https-isolated.log`):

```
[info]  Using CA Certificate Path .../lab/certs/ca-bundle-cli.pem
[info]  HTTP request (effective url: https://cli.speedtest.net/api/cli/config?...)
        completed with response code 200          <-- the stub answered
[info]  configuration content: {... "servers":[{"id":"4063","host":"myspeed.gorge.net:8080", ...}]}
[error] License - No matching license key found (LICENSE_ERROR)
[error] Configuration - Invalid license key in configuration (InvalidLicenseKey)
exit code 2
```

So the CLI **does** reach the stub over TLS with the laboratory CA, **does**
accept the server list, and then aborts on the licence check.

**FACT:** the licence key in the configuration document is bound to the device
id and the ISP context that the CLI detects, so it cannot be replayed from a
captured document.  This limitation is recorded, not hidden — and it is why
the successful runs use the genuine control plane for the configuration only,
while the *measurement* still happens entirely against the laboratory daemon.

**Correction to an earlier run of this experiment.** The first attempt at the
isolated scope failed earlier than the licence check, with
`Network is Unreachable` / `Cannot retrieve configuration document (0)`.
Root cause: the stub was started through `sudo` from inside the user
namespace, where `sudo` cannot read `/etc/sudoers`, so the stub never
started and the CLI had nothing to talk to.  The scope was **broken, not
limited**.  After the fix (stub started unprivileged inside the namespace)
the isolated scope reproduces the documented `LICENSE_ERROR` deterministically.

---

## 2. Results

### 2.1 Daemon in TLS mode (C-01)

Artefact: `lab/results/cli-cross-validation-https-real.json`
(final run of 2026-11-04, 06:12 UTC+07).

| Metric | Value |
| --- | --- |
| CLI exit code | **0** |
| `server.id` / `server.host` / `server.port` | `4063` / `myspeed.gorge.net` / `8080` |
| **`server.ip`** | **`127.0.0.1`** ← the traffic reached the laboratory daemon |
| `ping.latency` | 0.105 ms (low 0.082, high 0.140, jitter 0.015) |
| `packetLoss` | 0 |
| `download.bandwidth` | 11 363 000 000 B/s (11.36 GB/s) |
| `upload.bandwidth` | 8 264 000 000 B/s (8.26 GB/s) |
| `result.persisted` | **false** |
| `interface.name` | `lo` |

Verbose log excerpts:

```
"Running Speedtest against host:port myspeed.gorge.net:8080"
"Resolved address 1: 127.0.0.1"
"Opening socket to '127.0.0.1'"
"Ping 1: 0.10 ms (0.10ms min, 0.00ms jitter)"
"Packet loss sent=169, received=169, dupes=0, maxId=168"
"HTTP request (effective url: https://results.speedtest.net/reports) completed with response code 503"
```

### 2.2 Daemon in plain HTTP mode (C-02)

Artefact: `lab/results/cli-cross-validation-http-real.json`.

Exit code **0**, `server.ip = 127.0.0.1`, `persisted: false`,
`ping.latency` 0.079 ms (low 0.072, high 0.105), loss 0 %,
↓ 11.95 GB/s, ↑ 7.70 GB/s, interface `lo`.

**Repeated runs** during this audit produced ↓ 11.36–12.55 GB/s and
↑ 5.43–8.87 GB/s.  The spread is the expected variance of a loopback
measurement, not a difference between the two daemon modes.

### 2.3 Fully isolated variant (C-03)

Exit code **2** — `LICENSE_ERROR`, see 1.4.

> **Never present the loopback bandwidth as internet capacity.**  12 GB/s over
> `lo` says nothing about a real link.  The numbers above are only evidence
> that the CLI and the daemon speak the same protocol.

---

## 3. Three-way comparison

| Layer | Official Speedtest CLI | Official OoklaServer | This Host Tester | Classification |
| --- | --- | --- | --- | --- |
| Address selection | resolves the FQDN, takes the first A record | binds `127.0.0.1:8080` | resolves A/AAAA, prefers a global IPv4, **filters non-public addresses** | **Functionally compatible** (the clone is stricter) |
| Handshake | `HI` → `HELLO` (its own error string: *"Did not receive HELLO"*) | `HELLO 2.11 (2.11.5) <build>` | `HI\n` → parses `HELLO <major> (<version>) <build>` | **Verified equivalent** |
| WebSocket | not used by the CLI | `GET /ws` → `101` + `HELLO` frame | same, with a strict `Sec-WebSocket-Accept` comparison | **Verified equivalent** |
| Crossdomain | not used by the CLI | `domain="*" to-ports="8080"` | parses the policy, requires the Ookla domains or `*`, checks the port | **Verified equivalent** |
| TLS | `--ca-certificate` **replaces** the trust store | TLS 1.3, `TLS_AES_256_GCM_SHA384` | `--ca-bundle` **replaces** the trust store, verification is never disabled | **Verified equivalent** |
| Scheme handling | n/a | serves HTTP and HTTPS on one port | `https://` input selects TLS for the daemon probes, `--daemon-tls` / `--no-daemon-tls` override | **Functionally compatible** |
| Legacy upload | n/a (own upload engine) | `size=` = raw Content-Length | `--upload-mode auto` accepts both algorithms, reports `detected_mode` | **Functionally compatible** |
| Legacy images | n/a | serves the ten files with the exact official sizes | compares the byte counts | **Verified equivalent** |
| Keep-alive | n/a | `Connection: Keep-Alive`, 0.37 ms reuse | two requests on one socket, reuse + timing | **Verified equivalent** |
| Packet loss | `sent=145, received=145, dupes=0` | answers the latency pings | **not measured** (the clone is a configuration tester, not a benchmark) | **Different by design** |
| Result publication | POSTs to `results.speedtest.net/reports` | — | never publishes anything | **Different by design** |
| UDP | config advertises `loadedLatency.enableUdp: true`, but the daemon does not answer a NetGauge datagram | binds UDP 8080 | **no UDP check** — a UDP probe would produce false failures | **Different by design (deliberate)** |
| Timeout behaviour | own engine | closes idle sockets | global budget (`--timeout`, default 180 s) + per-socket clamps | **Different by design** |
| Error reporting | structured JSON log records | structured log lines | one row per check, `PASSED`/`FAILED` + the raw response | **Different by design** |
| Success criteria | benchmark completed | — | 19 checks, all `PASSED` | **Different by design** |
| Server identity | from the configuration API | `HELLO 2.11 (2.11.5) <build>` | parsed from `HELLO`, shown as `Version: … Build Date: …` | **Verified equivalent** |
| TLS behaviour | `--ca-certificate` replaces the store | presents its chain | same semantics; an untrusted chain yields `FAILED`, never `PASSED` | **Verified equivalent** |

### 3.1 Statements that remain open

| Question | Status |
| --- | --- |
| Does the official `POST /host-tester` run the same 19 checks? | **Not independently verifiable** (reCAPTCHA; not bypassed) |
| Does the official tester use the same upload algorithm? | **Not independently verifiable** — the clone supports both because the two observed endpoints differ |
| Does the official tester probe UDP? | **Not independently verifiable** |
| Is the official result layout the same as the clone's? | **Not independently verifiable** — the clone's layout is an approximation of the public schema |
| Are Ookla's regional watchdogs equivalent to a single sandbox? | **No** — the clone's own result pages say so |

---

## 4. Reproduction

```bash
sh lab/scripts/download-official.sh        # fetch + hash-verify the binaries
sh lab/scripts/make-certs.sh               # laboratory CA, leaf and negatives
sh lab/scripts/cross-validate-cli.sh https real       # C-01  -> exit 0
sh lab/scripts/cross-validate-cli.sh http  real       # C-02  -> exit 0
sh lab/scripts/cross-validate-cli.sh https isolated   # C-03  -> exit 2 (LICENSE_ERROR)
```

The script removes its `/etc/hosts` entries on exit and prints
`OK: no lab entries left in /etc/hosts`; it also stops any daemon that is
already sharing port 8080, because OoklaServer binds with `SO_REUSEPORT`.

Artefacts: `lab/results/cli-cross-validation-https-real.{json,log}`,
`lab/results/cli-cross-validation-http-real.{json,log}`,
`lab/results/cli-cross-validation-https-isolated.log`,
`lab/results/cli-stub-state.json`,
`lab/results/cli-config-device.json`,
`lab/results/cli-config-real.json`.
