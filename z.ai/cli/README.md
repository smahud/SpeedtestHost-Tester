# Speedtest Host Tester — CLI

CLI untuk memvalidasi server Ookla Speedtest langsung dari terminal —
cara kerjanya sama persis dengan halaman **Server Tester** speedtest.net
(host-tester) dan dengan web app di `../web` (keduanya memakai engine yang
sama, `../web/src/lib/host-tester.ts`).

Tanpa captcha, tanpa banner — cukup input URL/host.

> 📄 **Catatan teknis lengkap** (lab OoklaServer resmi 2.11.5.2, konfigurasi,
> protokol netgauge, ukuran file, sertifikat, checklist update):
> lihat `../docs/OoklaServer-Technical-Notes.md`.

## Cara pakai

Butuh Node.js ≥ 18. Tanpa dependensi apa pun.

```bash
# host + port
node speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080

# cukup domain — port otomatis :8080
node speedtest-host-tester.mjs host.yapsidarussalam.or.id

# durasi test lebih pendek (detik)
node speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080 --download 5 --upload 5

# output JSON (untuk script/monitoring)
node speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080 --json

# buat executable
chmod +x speedtest-host-tester.mjs
./speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080
```

## Opsi

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `--json` | – | Output JSON saja (machine-readable) |
| `--no-color` | – | Matikan warna ANSI |
| `--download <detik>` | 10 | Durasi tes download |
| `--upload <detik>` | 10 | Durasi tes upload |
| `--samples <n>` | 10 | Jumlah sampel latency |
| `--timeout <detik>` | 150 | Batas waktu total |
| `-h`, `--help` | – | Bantuan |

**Kode keluar:** `0` = semua cek lulus · `1` = ada cek gagal · `2` = input salah.

## Apa saja yang dicek (identik dengan Ookla Server Tester)

1. **Hostname resolution** — DNS
2. **OoklaServer daemon** menerima koneksi (GET `/`)
3. **Versi daemon** — lewat handshake netgauge `HI` → `HELLO <versi>` di `ws(s)://host:port/ws`
4. **Netgauge / WebSocket** di port 8080 — `PING` → `PONG`
5. **HTTPS** — handshake TLS + respons
6. **Keep-Alive** — header `Connection`
7. **Latency file** — `GET /speedtest/latency.txt`
8. **Download images** — `GET /speedtest/random*.jpg` (350–4000, 10 file)
9. **Legacy upload script** — `POST /speedtest/upload.php` → balasan `size=N`
10. **Crossdomain** — `GET /crossdomain.xml`

Lalu pengukuran dengan metodologi resmi Ookla (HTTP legacy):

- **Ping** — sampel berulang, nilai terendah jadi hasil akhir (netgauge WS + HTTP)
- **Download** — pre-test → pemilihan ukuran file → 2/4 thread paralel (≥4 Mbps = 4 thread), cache-buster acak, agregasi sampel ala Ookla (buang 2 tercepat + ¼ terbawah, rata-rata sisanya)
- **Upload** — pre-test → chunk seragam → hingga 4 thread, chunk diurutkan, setengah tercepat dirata-rata

## Contoh hasil

```
  ✔ Hostname resolution ......................... PASS 1ms  125.164.215.24
  ✔ OoklaServer daemon connection ............... PASS 16ms  OoklaServer daemon detected (HTTP 200)
  ✔ OoklaServer daemon version .................. PASS 2.11 (2.11.5) 2026-06-04.1737.7d0993d
  ✔ Netgauge / WebSocket (port 8080) ............ PASS  wss://host:8080/ws · HI→HELLO, PING→PONG ok
  ✔ HTTPS functionality ......................... PASS  HTTPS 200 · TLSv1.3, CN=…
  ✔ Keep-Alive .................................. PASS  Connection: Keep-Alive
  ✔ Latency file (speedtest/latency.txt) ........ PASS  HTTP 200 · "test=test"
  ✔ Download image files (random*.jpg) .......... PASS  10/10 files (240 KB – 30.2 MB)
  ✔ Legacy HTTP upload script (upload.php) ...... PASS  HTTP 200 · size=265
  ✔ Crossdomain settings (crossdomain.xml) ...... PASS  HTTP 200 · policy found

  Ping           21.4 ms   min 21.4 / avg 23.1 / jitter 1.2 (10 samples)
  Download      87.42 Mbps   4 threads · random3000x3000.jpg · 172 MB in 10.1s
  Upload       45.18 Mbps   4 threads · 2.00 MB chunks · 56 MB in 10.0s

  ✔ Server is publicly available and properly configured.
```

> Catatan: kecepatan yang terukur adalah kecepatan **dari mesin tempat CLI
> dijalankan menuju server** — sama seperti perilaku Server Tester Ookla.
> Untuk mengukur jalur server Anda sendiri, jalankan CLI dari jaringan
> yang relevan.

> Contoh di atas adalah tangkapan asli saat target online (2026-11-02).
> Pada build saat ini (v1.0.1), bila netgauge WebSocket tersedia, ping
> diambil dari 5 PING netgauge (`(5 samples, netgauge WebSocket PING)`)
> dengan fallback ke sampel HTTP (`--samples`, default 10). v1.0.1 juga
> memperbaiki target IPv6 literal (`[::1]:8080`) yang sebelumnya gagal
> 5 cek karena URL dibangun tanpa bracket IPv6 — lihat
> `../cross-validation/README.md`.
