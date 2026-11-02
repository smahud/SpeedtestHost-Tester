# OoklaServer simulation workspace

Direktori ini berisi simulasi nyata OoklaServer official untuk menggantikan dugaan pada project clone `speedtest.net/host-tester`.

Baca **`SIMULASI.md`** untuk narasi lengkap dan **`manifest.json`** untuk seluruh variabel teknis dalam bentuk mesin.

## Ringkas

- Binary official x86_64 + aarch64 static-musl diunduh dari `install.speedtest.net`.
- Yang dijalankan: x86_64, versi `2.11.5.2`, build `2026-06-04.1737.7d0993d`.
- Daemon hanya di `127.0.0.1:8080` (TCP + UDP), mode `-d`.
- Dua mode: HTTP (`http/OoklaServer.properties`) dan HTTPS (`https/OoklaServer.properties`) dengan CA lokal.
- Terverifikasi: port 8080 melayani **HTTP dan TLS sekaligus** saat custom cert dipasang.
- Control server terpisah di `127.0.0.1:80` menyajikan `http_legacy_fallback.zip` untuk legacy checker clone.
- **Cross-validation:** official Speedtest CLI `1.2.0.84` diarahkan lewat `/etc/hosts` (`myspeed.gorge.net` → `127.0.0.1`) dan berhasil speedtest penuh ke daemon lokal, 4 variasi exit 0.
- Hasil clone: HTTP mode **18/19**, HTTPS mode **19/19 PASSED** — termasuk setelah naik ke **v1.2.0** dengan opsi `--ca-bundle`, `--legacy-port`, `--upload-mode`, `--daemon-tls`.

## Isi

| Path | Isi |
| --- | --- |
| `../OoklaServer-linux-*.tgz` | Tarball official yang diunduh |
| `../x86_64/`, `../aarch64/` | Binary + `OoklaServer.properties.default` hasil ekstraksi |
| `certs/` | CA, server key/cert, fullchain, extension file |
| `http/`, `https/` | Config yang dipakai saat menjalankan daemon |
| `legacy/` | Salinan kecil file legacy + manifest SHA-256 |
| `legacy_fallback.py` | Server kontrol port 80, membaca zip dari `.cache` tanpa ekstraksi |
| `scripts/` | Download, start, dan test script |
| `results/` | JSON/TXT/HTML hasil CLI + API + probe langsung |
| `manifest.json` | Semua variabel teknis terstruktur |
| `SIMULASI.md` | Dokumen audit simulasi + status pembaruan v1.2.0 |
| `CROSS_VALIDATION.md` | Cross-analysis official Speedtest CLI ↔ official OoklaServer ↔ clone |
| `../speedtest-cli/` | Binary + tarball klien Speedtest CLI resmi |
| `results/cli-*.json`, `cli-*.log` | Bukti speedtest resmi ke localhost |
| `results/v1.2/` | Hasil clone v1.2.0 setelah perbaikan code |

## Catatan penting

- Zip legacy 95 MB ada di `/home/user/.cache/http_legacy_fallback.zip`, **tidak** disalin ke workspace snapshot.
- CA sudah ditambahkan ke system trust; app dijalankan dengan `SSL_CERT_FILE=.../ca.crt`.
- `allow_private=1` / `--allow-private` wajib karena `localhost` termasuk private.
- Jangan commit binary aarch64 atau zip legacy ke repo perbandingan tanpa pertimbangan ukuran.
- Redirect `/etc/hosts` **tidak** ikut snapshot workspace; jalankan `scripts/add-hosts-redirect.sh` lagi setelah restart sandbox.
- Official CLI `--ca-certificate` menggantikan trust store; pakai `certs/ca-bundle-cli.pem` (CA publik + CA lab).
