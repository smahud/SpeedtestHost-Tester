# PROTOCOL_MATRIX.md — observed behaviour of the official server

Every row was **observed directly against the genuine official OoklaServer
`2.11.5.2`** (raw sockets / `curl` / `openssl s_client` / the official
Speedtest CLI), never inferred from documentation.  Raw evidence:
`lab/results/probe-http.json`, `lab/results/probe-https.json`,
`lab/results/cli-cross-validation-*.log`.

## 1. Transport layer

| Layer | Observation | Class |
| --- | --- | --- |
| TCP | `127.0.0.1:8080` accepts raw NetGauge and HTTP/HTTPS on the **same** port | **FACT** |
| UDP | the daemon **binds** `127.0.0.1:8080/udp` but does **not** answer a NetGauge `HI` datagram (6 payload variants, 5 s timeout each) | **FACT** |
| HTTP | `GET /hi` → `200 text/plain; charset=UTF-8`, body `hello 2.11 (2.11.5) 2026-06-04.1737.7d0993d` (44 B) | **FACT** |
| HTTPS | `GET /hi` over TLS on the same port → `200`, same body | **FACT** |
| Multiplexing | plain HTTP **and** TLS **and** raw TCP **and** WSS are all served concurrently on port 8080 once a TLS context is configured | **FACT** |
| TLS | `TLSv1.3`, `TLS_AES_256_GCM_SHA384`, `Verify return code: 0 (ok)`; daemon minimum TLS 1.2 | **FACT** |
| HTTP/1.1 | keep-alive supported: `Connection: Keep-Alive`, second request on the same socket answered in 0.37 ms | **FACT** |
| HTTP/1.0 | the daemon answers HTTP/1.1 requests with `HTTP/1.1 200 OK` | **FACT** |

**DECISION:** the implementation therefore probes the daemon port in plain TCP
by default and adds a *separate* HTTPS probe on the same port.  A single
"protocol sniffing" assumption is never made.

## 2. NetGauge (raw TCP)

| Step | Observation |
| --- | --- |
| Client sends `HI\n` | — |
| Server answers | `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d\n` |
| Client sends `QUIT\n` | server closes |
| Over TLS | identical answer, the handshake simply runs inside the TLS session |

The official Speedtest CLI binary contains the literal error string
`Protocol error: Did not receive HELLO; input:%s result:%s key:%s`, which
proves that the genuine client uses the **same** `HI` → `HELLO` handshake as
the clone's `netgauge` check.

## 3. WebSocket

| Step | Observation |
| --- | --- |
| Request | `GET /ws HTTP/1.1` with `Upgrade: websocket`, `Sec-WebSocket-Version: 13`, `Sec-WebSocket-Key: <base64>`, `Origin: https://www.speedtest.net` |
| Response | `HTTP/1.1 101 Switching Protocols`, `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Accept: <base64(sha1(key+GUID))>` |
| Frame | client sends a masked text frame `HI\n`; server answers with an **unmasked** text frame `HELLO 2.11 (2.11.5) ...` |
| Over TLS | identical (wss) |

## 4. Crossdomain policy

```
GET /crossdomain.xml  ->  200 text/xml, 115 bytes
<?xml version="1.0"?>
<cross-domain-policy>
<allow-access-from domain="*" to-ports="8080"/>
</cross-domain-policy>
```

With `OoklaServer.allowedDomains = *` (the laboratory configuration) the
daemon answers with a wildcard.  A production daemon configured with
`allowedDomains = *.ookla.com, *.speedtest.net` answers with one
`allow-access-from` element per domain, which is why the implementation
accepts either the explicit domains or the `*` wildcard.

## 5. Legacy HTTP endpoints served by the daemon itself

| Endpoint | Observation |
| --- | --- |
| `GET /speedtest/latency.txt` | `200 text/plain; charset=UTF-8`, body `test=test\n` (10 B) |
| `POST /speedtest/upload.php` | `200`, body `size=<raw POST Content-Length>` |
| `GET /speedtest/upload.php` | `404` (the endpoint is POST-only) |
| `GET /speedtest/random{W}x{H}.jpg` | `200 image/jpeg`, **exactly** the official byte sizes |

The ten image sizes were re-measured against the daemon and match the
official legacy package byte for byte:

| File | Bytes | File | Bytes |
| --- | ---: | --- | ---: |
| `random350x350.jpg` | 245 388 | `random2500x2500.jpg` | 12 407 926 |
| `random500x500.jpg` | 505 544 | `random3000x3000.jpg` | 17 816 816 |
| `random750x750.jpg` | 1 118 012 | `random3500x3500.jpg` | 24 262 167 |
| `random1000x1000.jpg` | 1 986 284 | `random4000x4000.jpg` | 31 625 365 |
| `random1500x1500.jpg` | 4 468 241 | | |
| `random2000x2000.jpg` | 7 907 740 | | |

**FACT:** the daemon itself satisfies all six legacy checks.  The separate
port-80 control server (`lab/scripts/legacy_control.py`) is only needed to
exercise the `--legacy-port 80` code path, and it reproduces the *legacy PHP*
size formula `500 + len(key) + len(value) + 3`, which the daemon does **not**
implement.

## 6. Upload size algorithm — the one real difference

| Endpoint | Algorithm | Evidence |
| --- | --- | --- |
| Legacy PHP fallback (port 80) | `size = 500 + Σ(len(key) + len(value) + 3)` | control server |
| **Official OoklaServer daemon** | `size = raw POST Content-Length` | measured: body 10 → `size=10`; 515 798 → `size=515798`; 1 981 498 → `size=1981498`; 516 300 → `size=516300` |

The implementation therefore exposes `--upload-mode auto|legacy|native` and
reports `detected_mode`, and the default `auto` accepts either.

## 7. What the implementation does *not* claim

| Item | Status |
| --- | --- |
| The daemon's internal watchdog / regional behaviour | **UNVERIFIABLE** (closed source) |
| The official `POST /host-tester` result page | **UNVERIFIABLE** (behind reCAPTCHA, not bypassed) |
| Whether the official tester probes UDP | **UNVERIFIABLE** — and a UDP probe would be a false-negative generator, because the daemon does not answer a NetGauge datagram |
| Exact pass/fail thresholds of the official tester | **UNVERIFIABLE** |

## 8. Clone ↔ daemon mapping

| Clone check | Transport | Endpoint | Expected result | Verified against the official daemon |
| --- | --- | --- | --- | --- |
| `netgauge` | TCP (or TLS) | `HI\n` | `HELLO <major> (<version>) <build>` | ✅ PASSED |
| `websocket` | TCP (or TLS) | `GET /ws` | `101` + valid `Sec-WebSocket-Accept` + `HELLO` frame | ✅ PASSED |
| `crossdomain` | TCP (or TLS) | `GET /crossdomain.xml` | required domains present, port allowed | ✅ PASSED |
| `https` | TLS | `GET /hi` | `200` + `hello …`, **verified chain** | ✅ PASSED (lab CA) / ✅ FAILED (untrusted CA) |
| `crossdomain` (legacy) | HTTP | `GET /crossdomain.xml` | required domains present | ✅ PASSED |
| `latency` | HTTP | `GET /speedtest/latency.txt` | body `test=test` | ✅ PASSED |
| `upload` | HTTP | `POST /speedtest/upload.php` | `size=516300` (legacy) or `size=515798` (daemon) | ✅ PASSED |
| `max_upload` | HTTP | `POST /speedtest/upload.php` | `size=1981500` (legacy) or `size=1980998` (daemon) | ✅ PASSED |
| `image_sizes` ×10 | HTTP | `GET /speedtest/randomNxN.jpg` | exact official byte size + `image/jpeg` + JPEG magic | ✅ PASSED |
| `keepalive` | HTTP | two requests, one socket | reuse, no `Connection: close`, < 2 s | ✅ PASSED |
