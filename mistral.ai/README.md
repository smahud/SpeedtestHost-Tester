# Submission mistral.ai — Clone Ookla Server Tester

Clone 1:1 https://www.speedtest.net/host-tester: **tanpa captcha, tanpa banner,
input cukup domain** (port default 8080), ditambah CLI, harness simulasi protokol
byte-accurate, kit simulasi binary resmi, dan kit cross-validation 3-arah
(**binary OoklaServer resmi × Speedtest CLI resmi 1.2.0 × clone**).

Target produksi: `host.yapsidarussalam.or.id:8080` — satu-satunya port terbuka;
HTTP dan HTTPS/TLS dilayani daemon OoklaServer di PORT YANG SAMA (8080).

## Isi submission (9 file)

| File | Isi |
| --- | --- |
| `README.md` | Laporan submission ini |
| `docs/protocol-reference.md` | Referensi protokol netgauge TCP (HI/PING/DOWNLOAD/UPLOAD/QUIT), HTTP di 8080 (/hi, crossdomain.xml, upload.php, latency.txt, random*.jpg, keep-alive, WebSocket), kunci config resmi, URL binary resmi, penyebab umum FAIL |
| `docs/infra-and-tools.md` | Kendala lingkungan agent, status validasi, temuan lintas-agent, metode cross-validation |
| `web/ookla-host-tester.html` | Clone web (8 check): satu file HTML self-contained, tanpa captcha/banner |
| `cli/ookla_host_tester.py` | CLI v1.1 (10 check): dns, netgauge TCP, websocket, version, crossdomain, https, upload, download, latency, keepalive; flag --json/--insecure/--timeout; exit 0/1 |
| `harness/ookla_protocol_test_harness.ts` | Harness simulasi protokol byte-accurate + 6 skenario (dieksekusi agent: 6/6 hijau, 0 assertion gagal) |
| `simulation/ookla_local_sim.sh` | Kit simulasi binary OoklaServer RESMI di lokal: unduh binary, cert self-signed, properties port-8080-only, ground-truth manual 8 path, jalankan CLI |
| `cross-validation/README.md` | Metode cross-validation 3-arah + ekspektasi bukti |
| `cross-validation/ookla_cross_validate.sh` | Kit otomatis: Speedtest CLI resmi 1.2.0 diarahkan (trick /etc/hosts domain→localhost) ke binary resmi di lokal, lalu dibandingkan dengan clone → crossval-report.md (verdict KONSISTEN/BELUM LENGKAP) |

## Yang sudah TERVERIFIKASI (benar-benar dieksekusi agent)

- **Simulasi protokol 6/6 skenario hijau, 0 assertion gagal** (harness TypeScript:
  simulator daemon netgauge TCP + HTTP/1.1 di satu port 8080, digabung dengan
  logika klien CLI):
  - S1 daemon sehat + TLS valid → semua check PASS.
  - S2 self-signed + --insecure → hanya https WARN; S2b strict → https FAIL
    (perilaku sama dengan tester resmi yang menolak self-signed).
  - S3 crossdomain.xml tanpa domain="*" → hanya crossdomain FAIL.
  - S4 latency.txt 404 → latency + keepalive FAIL.
  - S5 port 8080 refused → semua check FAIL.
- **Byte-accurate**: DOWNLOAD 5000000 → tepat 5.000.000 byte (prefix
  "DOWNLOAD " + pola JABCDEFGHI berulang); UPLOAD 2000000 0 → payload klien
  1.999.983 byte (2.000.000 − 17 byte command-line), server membalas
  OK 2000000 <timestamp>.
- Harness menangkap bug wiring-nya sendiri saat pengembangan (keepalive semula
  memakai server baru, bukan server skenario) → assertion terbukti efektif.

## Perbaikan CLI v1.1 (hasil cross-analysis antar-agent di repo ini)

1. **User-Agent di semua request** HTTP + upgrade WebSocket — server produksi
   Ookla mereset klien tanpa UA (temuan z.ai dari daemon produksi).
2. **IPv6-literal** (`[::1]:8080`) via getaddrinfo — bug kelas sama dengan
   ERR_INVALID_URL yang ditemukan z.ai di engine mereka (fix v1.0.1 mereka).
3. **File legacy dual-base**: latency.txt, upload.php, random*.jpg dicoba di "/"
   lalu fallback "/speedtest/" — z.ai memverifikasi daemon resmi menyajikan file
   legacy di /speedtest/; keepalive tetap satu koneksi TCP; download
   mem-verifikasi file di kedua base via Range probe.

## Cross-validation 3-arah (menunggu eksekusi di mesin user)

Karena CLI resmi ke OoklaServer memakai **netgauge TCP murni (zero HTTP)**
(temuan z.ai), sertifikat self-signed tidak mengganggu CLI resmi. Ekspektasi
bukti utama: result.server.ip == 127.0.0.1 di output JSON CLI resmi (selaras
arena.ai: server id 4063 myspeed.gorge.net:8080, exit 0).

Jalankan: sudo bash cross-validation/ookla_cross_validate.sh → tempelkan kembali
log console + ~/ookla-crossval/crossval-report.md untuk analisis final sebelum
merge.

## Kendala jujur

- Sandbox agent TIDAK bisa mengeksekusi ELF / akses network (terbukti empiris:
  bash = emulasi tanpa wget/tar/python/openssl, /dev/tcp stub tanpa data, egress
  proxy menolak port 8080 eksternal) → binary resmi tidak bisa dijalankan agent;
  kit disiapkan untuk dijalankan di mesin user.
- Connector GitHub di sisi agent hanya bisa BACA repo ini (semua operasi tulis
  403 Resource not accessible by integration) → push dilakukan via script pusher
  Python + PAT dari mesin user. PAT disposable tidak disimpan/dipakai agent;
  sebaiknya di-revoke setelah push.

## Cara menjalankan

    # CLI clone (input cukup domain; port default 8080)
    python3 cli/ookla_host_tester.py host.yapsidarussalam.or.id:8080
    python3 cli/ookla_host_tester.py host.example.com --json

    # Web clone: buka web/ookla-host-tester.html di browser, isi domain

    # Simulasi binary resmi di lokal (ground truth)
    bash simulation/ookla_local_sim.sh

    # Cross-validation 3-arah
    sudo bash cross-validation/ookla_cross_validate.sh

## Saran merge untuk agent utama

- Protokol netgauge + HTTP surface ketiga agent identik → aman dijadikan basis
  merge; ambil fitur unik per agent (mis. flag --ca-bundle/--legacy-port dari
  arena.ai v1.2.0, metodologi pengukuran Ookla dari z.ai, dual-base legacy + UA
  wajib dari sini).
- Sebelum merge final, jalankan kit cross-validation di mesin user dan pastikan
  verdict KONSISTEN.
