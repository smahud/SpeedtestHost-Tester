# Official OoklaServer binary manifest

The official OoklaServer daemon is **proprietary and is not committed to this
repository**.  It is downloaded and hash-verified by
[`lab/scripts/download-official.sh`](../scripts/download-official.sh); the
values below are the contract that the script enforces.

| Item | Value |
| --- | --- |
| x86_64 tarball URL | `https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz` |
| x86_64 tarball size | 4 911 401 bytes |
| x86_64 tarball SHA-256 | `ce180aa3ed9b3c099713cf37ea2ded48c1f799f47c534ab732e21cea61598159` |
| x86_64 binary size | 15 550 832 bytes |
| x86_64 binary SHA-256 | `f19e5ed240dc185bcaf6ca96e0fa40d5ee53e3a543f4c562082ac0d8d92f027a` |
| aarch64 tarball URL | `https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-aarch64-static-musl.tgz` |
| aarch64 tarball size | 5 270 518 bytes |
| aarch64 tarball SHA-256 | `c72b4f4380f5fed6d43a6a1460055de0d43149cba178c0ebde7ba6af12061615` |
| aarch64 binary size | 13 824 464 bytes |
| aarch64 binary SHA-256 | `f7fd93c377ac4b7640a8b1ddba1f87254cd731e6d0d73111588a6dda9780edaa` |
| daemon version | `2.11.5.2` |
| daemon build | `2026-06-04.1737.7d0993d` |
| `Last-Modified` (both tarballs) | `Thu, 18 Jun 2026 21:46:26 GMT` |
| ETag (x86_64) | `edf490f4a7a2d204e3989d1e9c368a3f` |
| ETag (aarch64) | `ea7c713f97a9ebe0666d6785ae3fef22` |

Each tarball contains exactly two files: `OoklaServer` (mode 755) and
`OoklaServer.properties.default` (5 869 bytes, mode 644).  The x86_64 binary
is `ELF 64-bit LSB pie executable, x86-64, static-pie linked, stripped`; the
aarch64 build is the same for ARM.

`OoklaServer.properties.default` (shipped inside the tarball) is committed as
`lab/binaries/OoklaServer.properties.default` for reference; the aarch64 copy
is identical and is stored as `lab/binaries/aarch64-properties.default`.

**Re-verification record** (independent re-audit, 2026-11-04): the three
official artefacts were downloaded again from the URLs above and their
SHA-256 values matched the previously recorded ones byte for byte, i.e. the
upstream artefacts had not changed.  See `../../validation/ENVIRONMENT.md`.
