# ENVIRONMENT.md — measured execution environment

All values below were **measured** in the sandbox that produced this audit
(2026-11-04, Asia/Jakarta), not copied from documentation.

## 1. Host

| Item | Value | How it was obtained |
| --- | --- | --- |
| OS | Debian GNU/Linux 13 (trixie) | `/etc/os-release` |
| Kernel | `Linux 6.1.189+ x86_64 GNU/Linux` | `uname -a` |
| Architecture | `x86_64` | `uname -m` |
| User | `user` (uid 1000), member of `sudo` | `id` |
| Passwordless sudo | available | `sudo -n true` |
| Container / VM | sandboxed container, not a dedicated VM | environment inspection |
| `mount` inside a user namespace | **denied** | `unshare -rn sh -c 'mount -t tmpfs tmpfs /tmp/x'` → `permission denied` |
| Network namespaces | available | `unshare -rn true` → ok |

Consequence of the `mount` restriction: a network namespace **cannot** shadow
`/etc/hosts`, so name redirection is done on the host `/etc/hosts` and the
namespace is used to guarantee that no traffic can escape.  Both effects are
restored when the experiment ends (`cross-validate-cli.sh` has an `EXIT` trap).

## 2. Toolchain

| Tool | Version |
| --- | --- |
| Python | 3.13.16 (CPython, `/usr/local/bin/python3`) |
| OpenSSL (library and CLI) | 3.5.7, 9 Jun 2026 |
| Node.js | v20.20.2 (not required by the implementation) |
| git | 2.x |
| curl / wget | present |
| Docker | **not available** — the daemon is run directly, bound to `127.0.0.1` |

The implementation itself requires **only the Python standard library**.

## 3. Official binaries (re-verified 2026-11-04)

| Artefact | Version | SHA-256 | Verified |
| --- | --- | --- | --- |
| `OoklaServer-linux-x86_64-static-musl.tgz` | — | `ce180aa3…98159` | ✅ matches the previously recorded value |
| `OoklaServer` (x86_64) | `2.11.5.2` / `2026-06-04.1737.7d0993d` | `f19e5ed2…2f027a` | ✅ |
| `OoklaServer-linux-aarch64-static-musl.tgz` | — | `c72b4f43…61615` | ✅ |
| `OoklaServer` (aarch64) | `2.11.5.2` | `f7fd93c3…78edaa` | ✅ |
| `ookla-speedtest-1.2.0-linux-x86_64.tgz` | — | `5690596c…cfeeb7` | ✅ |
| `speedtest` | `1.2.0.84 (ea6b6773cf)` | `31f1124c…3c051` | ✅ |

HTTP metadata of the downloads (re-fetched, unchanged):

```
last-modified: Thu, 18 Jun 2026 21:46:26 GMT     (both OoklaServer tarballs)
etag: "edf490f4a7a2d204e3989d1e9c368a3f"         (x86_64)
etag: "ea7c713f97a9ebe0666d6785ae3fef22"         (aarch64)
last-modified: Tue, 09 Aug 2022 21:22:02 GMT      (Speedtest CLI tarball)
etag: "76de75a734cf98d70eee0d362bad365a"
```

**FACT:** the upstream artefacts are byte-identical to the ones the previous
audit session used; the previous session's hashes are therefore confirmed, not
contradicted.  The CLI *binary* hash (`31f1124c…`) was **not** recorded
before and is new evidence added by this audit.

## 4. Laboratory network configuration

| Item | Value |
| --- | --- |
| OoklaServer daemon | `127.0.0.1:8080` — **TCP and UDP**, port 8080 only |
| OoklaServer data plane | `OoklaServer.tcpPorts/udpPorts/httpPorts = 8080` |
| Legacy control server | `127.0.0.1:80` (`lab/scripts/legacy_control.py`) |
| CLI control-plane stub | `127.0.0.1:443` (`lab/scripts/cli_stub.py`) |
| Clone web server | `0.0.0.0:3000` (Arena live preview) |
| Name redirection | `/etc/hosts`, temporary, restored by an `EXIT` trap |

The daemon is started with `-d` (develop mode) so that it neither forks nor
self-updates.  `OoklaServer.enableAutoUpdate = false` and
`OoklaServer.ssl.useLetsEncrypt = false` are set in both configurations, so
the daemon never contacts Ookla.

## 5. Laboratory TLS configuration

| Item | Value |
| --- | --- |
| CA | `C=ID, ST=East Java, L=Malang, O=ArenaLab, OU=OoklaServer Lab, CN=ArenaLab Root CA` |
| CA key | RSA 4096, `basicConstraints=critical,CA:TRUE,pathlen:0` |
| Leaf | `CN=localhost`, RSA 2048, `SAN = DNS:localhost, IP:127.0.0.1, IP:::1` |
| Leaf validity | 2026-11-04 → 2029-02-06 |
| Chain | `fullchain.pem = server.crt + ca.crt` (what the daemon is configured with) |
| Negative: wrong host | `SAN = DNS:not-the-lab-host.invalid, DNS:other.invalid` |
| Negative: expired | `notBefore 2020-01-01`, `notAfter 2020-01-02`, otherwise valid and CA-signed |
| Negative: untrusted | self-signed `CN=localhost` with the correct SAN |
| Control plane | `CN=cli.speedtest.net`, `SAN = DNS:cli.speedtest.net, DNS:results.speedtest.net, DNS:localhost, IP:127.0.0.1` |
| Negotiated cipher | `TLSv1.3` / `TLS_AES_256_GCM_SHA384`, `Verify return code: 0 (ok)` |

Private keys (`*.key`) and CSRs are **never committed**; `arena.ai/.gitignore`
enforces this, and `tests/test_security.py` fails the build if a private key
appears in a source file.

## 6. Time and resource budget

| Experiment | Wall clock | Notes |
| --- | --- | --- |
| Full host-tester run against the daemon (19 checks, ~87 MB of images) | ~3.4 s | `lab/results/final-hosttester-tls.json` |
| Raw daemon probe (HTTP mode) | ~5 s | `lab/results/probe-http.json` |
| Raw daemon probe (TLS mode) | ~6 s | `lab/results/probe-https.json` |
| Official CLI full benchmark | ~25 s | 15 s engine window + start-up |
| Regression suite (77 tests) | ~25 s | no network access required |
