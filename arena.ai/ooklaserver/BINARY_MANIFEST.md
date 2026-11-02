# Official binary manifest

| Arch | Tarball | SHA-256 tarball | Binary in repo | SHA-256 binary |
| --- | --- | --- | --- | --- |
| x86_64 static-musl | `OoklaServer-linux-x86_64-static-musl.tgz` | `ce180aa3ed9b3c099713cf37ea2ded48c1f799f47c534ab732e21cea61598159` | `x86_64/OoklaServer` | `f19e5ed240dc185bcaf6ca96e0fa40d5ee53e3a543f4c562082ac0d8d92f027a` |
| aarch64 static-musl | `OoklaServer-linux-aarch64-static-musl.tgz` | `c72b4f4380f5fed6d43a6a1460055de0d43149cba178c0ebde7ba6af12061615` | not copied (size) | `f7fd93c377ac4b7640a8b1ddba1f87254cd731e6d0d73111588a6dda9780edaa` |

Both tarballs are committed. Only the x86_64 binary is committed because that is the architecture actually executed in the sandbox; the aarch64 binary can be reproduced from its tarball. `aarch64/OoklaServer.properties.default` is included for comparison.

Lab CA/server private keys (`*.key`, `*.csr`) are intentionally **not** committed; regenerate with the commands in `sim/SIMULASI.md`. The 95 MB `http_legacy_fallback.zip` is also not committed; `sim/scripts/reproduce-download.sh` plus `sim/legacy/legacy-files.sha256` document how to obtain it.
