# ChatGPT — local Speedtest host tester

Submission date: 2026-11-03 (Asia/Jakarta). Python **3.10+**, standard library only.
A separate implementation for comparison; no other agent implementation is changed.

## Run

From the repository root:

```sh
# Local web UI — open http://127.0.0.1:8000/host-tester
python3 chatgpt/app.py

# CLI — domain, host:port, bracketed IPv6, or HTTP(S) URL
python3 chatgpt/cli.py example.com
python3 chatgpt/cli.py https://example.com:8080 --json -o result.json
python3 chatgpt/cli.py example.com:8080 --summary

# Explicit opt-in for a trusted lab; custom CA verification remains strict
python3 chatgpt/cli.py https://localhost:8080 --allow-private \
  --legacy-port 8080 --ca-bundle /path/to/ca.crt
python3 chatgpt/app.py --allow-private --legacy-port 8080 --ca-bundle /path/to/ca.crt

# Regression tests; no external services or Python packages required
python3 -m unittest discover -s chatgpt/tests -v

# Official binary lab: Linux x86_64, OpenSSL, sibling arena.ai binary required
python3 chatgpt/tests/official_lab.py
```

CLI exit codes: `0` all checks pass; `1` at least one check fails; `2` invalid input,
DNS/configuration/output error; `130` keyboard interruption. JSON is written to stdout,
diagnostics to stderr. `--quiet -o FILE` suppresses stdout. `--help` lists all options.

A bare domain uses port 8080. An HTTPS URL enables TLS for NetGauge, WebSocket and
crossdomain; the dedicated HTTPS check always verifies TLS. `--daemon-tls` enables
the same behavior for bare hosts. Legacy checks remain **HTTP**, on port 80 unless
`--legacy-port` is supplied. A custom CA replaces the system trust store. URL paths,
queries and fragments are ignored with a normalization note. Credentials and unsupported
URL schemes are rejected. No redirects are followed.

## What is included

| File | Purpose |
| --- | --- |
| `engine.py` | Shared 19-check engine, adapted and hardened from Arena's submission |
| `cli.py` | Text/JSON CLI, summary and output options |
| `app.py`, `index.html`, `style.css` | Local web UI with one visible host field; server-rendered results |
| `tests/test_engine.py` | 16 regression tests, including malformed protocols and request protections |
| `tests/official_lab.py` | Reproducible official-daemon lab, trusted/untrusted TLS and web POST checks |
| `results/` | Actual results from this submission's execution |
| `AUDIT.md` | Findings, validation scope and limitations |
| `ATTRIBUTION.md` | Source provenance and reuse boundaries |

The UI has no CAPTCHA, advertisements, analytics, JavaScript or external resources.
It uses an independent dark layout with accessible labels, keyboard focus, responsive
CSS and expandable diagnostics. It is **not a pixel-identical copy** of the original.

The 19 checks are NetGauge HELLO, WebSocket HELLO, daemon crossdomain, strict HTTPS,
legacy crossdomain, latency, upload, max upload, ten image fingerprints, and KeepAlive.
There are no synthetic download/upload speed scores. A run transfers approximately
105 MB; this is a configuration tester, not a bandwidth benchmark.

## Isolation and safety

The web listener is fixed to loopback, accepts localhost/127.0.0.1 Host headers, has
form-session CSRF validation, and permits one active test. A subprocess enforces a
180-second web budget. Private targets and custom CA paths can only be enabled by the
operator's startup flags, never by form fields. GET requests cannot trigger testing.
Do not expose this development HTTP server as a public service.

The engine filters **every** non-global resolved IP unless explicitly opted in,
then pins the vetted DNS snapshot for both daemon and legacy connections. TLS SNI and
hostname verification still use the original hostname. HTTP bodies are bounded and
streamed with only a 4 KiB diagnostic prefix retained. WebSocket frames/messages and
handshake headers are bounded. Sockets close on failure and success.

CLI sockets have inactivity timeouts, not an overall deadline; OS DNS lookup and
slow trickling responses can extend a CLI run. For a strict unattended deadline on
Linux, use `timeout 180s python3 chatgpt/cli.py ...` (exit 124 means timeout).

## Independently observed results

- **16/16** unit/integration regression tests passed.
- **19/19** checks passed against the repository's official OoklaServer binary with
  a newly generated trusted certificate on an ephemeral loopback port.
- Actual web form POST through the shared CLI: **19/19** passed.
- Same daemon without trusting its certificate: **4 TLS daemon failures / 15 HTTP passes**.
- Refused local port: all **19** checks fail in regression testing.

The lab verifies the existing binary's SHA-256 before execution, generates ephemeral
keys, disables auto-update and Let's Encrypt, binds loopback, cleans up its own daemon,
and does not edit `/etc/hosts`, system trust, production configuration, or other agents.
The application can be copied out of `chatgpt/` and run independently; only the optional
lab script depends on the sibling binary. See `AUDIT.md` for what was not verified.
