# PROTOCOL_MATRIX — official OoklaServer 2.11.5.2 behavior (build 2026-06-04.1737.7d0993d)

Every row below was measured against the **official binary** in the local lab
(port 8080, TCP+UDP) on 2026-11-03. Evidence: `lab/results/probe-protocol-8080.json`,
`lab/results/probe-cors-upload.json`, daemon access log, scenario runs in
`lab/results/regression-lab.txt`.

Classification per row: **VERIFIED** (reproduced this round) / **OBSERVATION**
(measured, single interpretation) / **NOT VERIFIABLE**.

## 1. Port & protocol multiplexing (VERIFIED)

| Probe | Result |
| --- | --- |
| TCP 8080 plain HTTP | 200 responses (`GET /`) |
| TCP 8080 TLS (HTTPS) | negotiates TLS 1.2/1.3, serves HTTP 307/200 |
| WS `ws://…:8080/ws` | 101 upgrade, RFC6455 accept-key valid |
| WSS `wss://…:8080/ws` | 101 upgrade over TLS on the **same port** |
| Raw TCP netgauge (plaintext) | `HI`/`PING`/`DOWNLOAD`/`UPLOAD` all answered |
| UDP 8080 | daemon listens (`Listening on UDP socket: 0.0.0.0:8080` + `[::]:8080`); naive text/binary probes get **no response** (proprietary binary protocol); the **official CLI** measured `packetLoss: 0` against it, implying working UDP netgauge with the proper framing (OBSERVATION) |
| IPv4 + IPv6 | dual-stack listeners confirmed |

**Conclusion:** one port, per-connection protocol detection (HTTP / TLS / netgauge
on TCP; netgauge UDP separately). No separate HTTP/HTTPS ports in 2.11.

## 2. HTTP endpoint surface (VERIFIED)

| Endpoint | Method | Status | Body / notes |
| --- | --- | --- | --- |
| `/` | GET | 200 | 109 B `OoklaServer … It worked!` HTML. Headers: `Connection: Keep-Alive`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, HSTS, strict CSP |
| `/hi` | GET | 200 | `hello 2.11 (2.11.5) 2026-06-04.1737.7d0993d\n` (44 B) — **plain-HTTP version endpoint** |
| `/speedtest/latency.txt` | GET | 200 | `test=test\n` |
| `/speedtest/random{n}x{n}.jpg` | GET/HEAD | 200 | deterministic sizes, see §3 |
| `/speedtest/upload.php` | POST | 200 | `size=<exact body byte count>` (sent 1009 B → `size=1009`) |
| `/speedtest/upload.php` | GET | 404 | POST-only |
| `/speedtest/upload.php?callback=test` | POST | 200 | same `size=` semantics (callback ignored) |
| `/speedtest/server.php` | GET | 404 | not present in 2.11 |
| `/favicon.ico`, arbitrary path | GET | 404 | |
| `/crossdomain.xml` | GET | 200 | policy with `allow-access-from domain="*"` |

### 2.1 User-Agent requirement (VERIFIED — NEW this round)

- `GET /hi` **without** a `User-Agent` header → **HTTP 500 Internal Server Error**
- with `User-Agent:` (even **empty value**) → 200.
- This is core daemon behavior (present with `userAgentFilterEnabled` unset), not
  the optional filter. The engine's always-send-UA design is therefore mandatory.
- Daemon access log records the UA per request (`%[useragent]`).

### 2.2 Range & methods (VERIFIED)

- `Range: bytes=0-1023` on random350 → **ignored**: 200 + full 245,388 B body, no `Content-Range`.
- HEAD returns headers incl. `Content-Length`, no body.

### 2.3 Keep-Alive (VERIFIED)

Two pipelined GETs on one socket → both 200; `Connection: Keep-Alive` on every response.

### 2.4 CORS (VERIFIED — NEW this round)

- With `Origin: <any-value>` → `Access-Control-Allow-Origin: <same-value>` (reflected, permissive).
- With `Origin: null` or no Origin → **no ACAO header**.

## 3. Download image fingerprints (VERIFIED — unchanged from rounds 1–3)

| File | Bytes |
| --- | --- |
| random350x350.jpg | 245,388 |
| random500x500.jpg | 505,544 |
| random750x750.jpg | 1,118,012 |
| random1000x1000.jpg | 1,986,284 |
| random1500x1500.jpg | 4,468,241 |
| random2000x2000.jpg | 7,907,740 |
| random2500x2500.jpg | 12,407,926 |
| random3000x3000.jpg | 17,816,816 |
| random3500x3500.jpg | 24,262,167 |
| random4000x4000.jpg | 31,625,365 |

## 4. WebSocket (VERIFIED)

| Probe | Result |
| --- | --- |
| Upgrade on `/ws` | **101**, valid `Sec-WebSocket-Accept` (SHA-1/base64 of key + GUID) |
| Upgrade on `/ws/` | 101 (trailing slash tolerated) |
| Upgrade on `/` | **200** (served as HTTP, no upgrade) |
| Upgrade on `/foo`, `/WS` | **404** — path is case-sensitive, `/ws` is required |
| netgauge over WS | `HI\n` → `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d` (text frame) |
| Unknown command | `ERROR` |

## 5. Raw TCP netgauge (VERIFIED)

| Command | Response |
| --- | --- |
| `HI\n` | `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d` |
| `PING <epoch-ms>\n` | `PONG <epoch-ms>` |
| `DOWNLOAD 100000\n` | **exactly 100,000 bytes**; the 9-byte ASCII prefix `DOWNLOAD ` is part of the payload (total includes it) |
| `UPLOAD 2048\n` + 2048 B | `OK 2048 <epoch-ms>` (payload may follow in the same burst or delayed) |
| `GARBAGE_COMMAND\n` | `ERROR` |

## 6. Host-header / canonical-name redirect (VERIFIED — NEW this round, high impact)

When the `Host` header does **not** match a certificate SAN (port stripped,
brackets **not** stripped):

- every plain-HTTP GET → **307 Temporary Redirect**, `Location: https://<cert-canonical-name>:<port>/`
- measured: Host `[::1]:8080`, `::1`, `some.other.host`, `[127.0.0.1]:8080` → 307 → `https://lab.ookla.test:8080/`
- Host `localhost`, `127.0.0.1:8080`, `lab.ookla.test` (in SANs) → 200
- **WS upgrade on `/ws` still succeeds** with a non-matching Host (redirect applies to HTTP handler only)
- Consequence: an IPv6-literal or wrong-hostname target cannot reach the legacy
  HTTP endpoints of this daemon version, even when the IP itself is in the cert
  SANs (bracketed Host never matches).

## 7. TLS (VERIFIED)

| Probe | Result |
| --- | --- |
| TLS 1.0 offered (`openssl s_client -tls1`, SECLEVEL=0) | rejected — `alert protocol version` (server-enforced floor) |
| TLS 1.1 | rejected likewise |
| TLS 1.2 | accepted (e.g. ECDHE-RSA-CHACHA20-POLY1305) |
| TLS 1.3 | accepted (TLS_AES_256_GCM_SHA384) |
| strict verify, lab CA bundle, SNI localhost | OK (subject CN=lab.ookla.test, issuer = lab CA) |
| strict verify, wrong hostname | **hostname mismatch** error |
| strict verify, no trusted CA | **unable to verify leaf** error |
| custom cert chain | daemon logs `Successfully loaded certificate chain with 0 intermediate certificate(s)` |

Ookla policy context (public docs, *Speedtest Server Network Acceptance Policy*):
HTTPS must be enabled for listing; manually-installed certificates must be
**not self-signed**; automatic Let's Encrypt provisioning starts only after
server submission. A pre-submission server therefore commonly runs self-signed.

## 8. Egress / control-plane behavior of the official CLI (VERIFIED, round 4)

- Config+server-list host: `cli.speedtest.net` (`GET /api/cli/config?deviceId=…&hid=…&sid=…&uname=…`)
- Result submission host: `results.speedtest.net` (round-2/3 proxy logs) — **blocked** in round 4 (non-publishing guarantee)
- No `--no-submit` option exists in CLI 1.2.0.84 (`--help` verified)
- The CLI accepts `--ca-certificate` (used to trust the lab CA) and `--accept-license`
