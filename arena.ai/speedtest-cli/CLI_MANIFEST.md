# Official Speedtest CLI manifest

| Item | Value |
| --- | --- |
| URL | `https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz` |
| Tarball size | 1,106,829 bytes |
| Tarball SHA-256 | `5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7` |
| Last-Modified | `Tue, 09 Aug 2022 21:22:02 GMT` |
| ETag | `"76de75a734cf98d70eee0d362bad365a"` |
| Extracted binary | `x86_64/speedtest` (2,613,400 bytes, mode 755) |
| `--version` | `Speedtest by Ookla 1.2.0.84 (ea6b6773cf) Linux/x86_64-linux-musl 6.1.158+ x86_64` |
| File type | ELF 64-bit LSB executable, x86-64, statically linked, stripped |

Also included: official `speedtest.md` help text and `speedtest.5` man page.

This binary is used only for cross-validation. It is driven with
`--host=myspeed.gorge.net --accept-license --accept-gdpr --format=json-pretty
--progress=no --ca-certificate=...` after `/etc/hosts` maps that server domain to
`127.0.0.1`. See `../ooklaserver/sim/CROSS_VALIDATION.md`.
