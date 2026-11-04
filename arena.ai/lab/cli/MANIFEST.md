# Official Speedtest CLI manifest

The official Ookla Speedtest CLI is **proprietary and is not committed to this
repository**.  `lab/scripts/download-official.sh` downloads and hash-verifies
it; the values below are the contract that the script enforces.

| Item | Value |
| --- | --- |
| URL | `https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz` |
| Tarball size | 1 106 829 bytes |
| Tarball SHA-256 | `5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7` |
| `Last-Modified` | `Tue, 09 Aug 2022 21:22:02 GMT` |
| ETag | `76de75a734cf98d70eee0d362bad365a` |
| Extracted binary size | 2 613 400 bytes |
| Extracted binary SHA-256 | `31f1124c5ab8acdae6b9fe1741e704df420f9f2e7d429679fabe62075453c051` |
| `--version` | `Speedtest by Ookla 1.2.0.84 (ea6b6773cf) Linux/x86_64-linux-musl` |
| File type | `ELF 64-bit LSB executable, x86-64, statically linked, stripped` |

The official `speedtest.md` help text and `speedtest.5` man page are
committed next to this file because they are documentation, not binaries.

## Relevant options (from the binary's own `--help`)

```
-L, --servers                     List nearest servers
-s, --server-id=#                 Specify a server from the server list using its id
-o, --host=ARG                    Specify a server using its host's fully qualified domain name
    --ca-certificate=ARG          CA Certificate bundle path
-f, --format=ARG                  human-readable | csv | tsv | json | jsonl | json-pretty
-p, --progress=yes|no
-v                                Logging verbosity (repeatable)
```

`--ca-certificate` **replaces** the trust store (it does not extend it),
which is exactly the semantics that the clone's `--ca-bundle` implements.

## How it is used in the laboratory

See `../../validation/CROSS_VALIDATION.md`.  The CLI is only ever pointed at
the laboratory daemon, and the result-submission endpoint is redirected to a
local stub that refuses the upload, so no laboratory measurement can be
published as a genuine public speedtest result.
