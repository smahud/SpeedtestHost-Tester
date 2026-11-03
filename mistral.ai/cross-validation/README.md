# Cross-Validation Kit - binary OoklaServer resmi x Speedtest CLI resmi x clone

Directory ini berisi kit cross-validation 3-arah untuk validasi lanjutan:
clone diuji bersanding dengan **binary OoklaServer resmi** DAN **Speedtest
CLI resmi 1.2.0**, bukan hanya simulasi level protokol.

## Metode: trick "domain -> localhost" (/etc/hosts)

1. Kit mengunduh binary OoklaServer resmi (stable, x86_64/aarch64) dan
   Speedtest CLI resmi 1.2.0 dari install.speedtest.net.
2. Perintah "speedtest -L -f json" mengambil daftar server Ookla publik;
   kit memilih satu entri port 8080 (override: env SERVER_ID).
3. Domain server tersebut dipetakan ke 127.0.0.1 / ::1 di /etc/hosts
   (blok bertanda, otomatis dipulihkan saat script selesai / Ctrl-C).
4. "speedtest -s <id>" kini TIDAK SADAR mengetes OoklaServer resmi yang
   berjalan di localhost: id sama, domain sama, tapi koneksi jatuh ke
   daemon lokal. Bukti keberhasilan trick: result.server.ip == 127.0.0.1
   pada output JSON CLI.
5. Clone (ookla_host_tester.py v1.1) mengetes daemon yang sama, lalu
   analisis silang otomatis menghasilkan crossval-report.md dengan verdict
   KONSISTEN / BELUM LENGKAP.

## Dasar temuan cross-agent (repo ini)

- z.ai memverifikasi (server 1010.hkspeedtest.com:8080 -> localhost) bahwa
  CLI resmi 1.2.0 melakukan zero HTTP request - pure netgauge TCP -
  sehingga sertifikat self-signed tidak mengganggu CLI; full test loopback
  ~0.06 ms / 67 Gbps.
- arena.ai memverifikasi trick /etc/hosts (server myspeed.gorge.net:8080,
  id 4063): CLI exit 0 dengan server.ip = 127.0.0.1.
- Temuan lintas-agent inilah yang mendasari CLI clone v1.1: User-Agent
  wajib di semua request (server produksi mereset klien tanpa UA), dukungan
  IPv6-literal via getaddrinfo, dan file legacy dicoba di / lalu
  /speedtest/.

## Pemakaian

    sudo bash ookla_cross_validate.sh
    sudo SERVER_ID=4063 bash ookla_cross_validate.sh
    sudo KEEP_RUNNING=1 bash ookla_cross_validate.sh

Kebutuhan: root (tulis /etc/hosts), wget atau curl, tar, openssl, python3,
Linux x86_64 atau aarch64. OoklaServer binary di-share dengan kit simulasi
(BASE_DIR, default $HOME/ookla-sim).

Output di CV_DIR (default $HOME/ookla-crossval): crossval-report.md,
cli-result.json, clone-result.json, servers.json, daemon.log, hosts.backup.

## Analisis silang yang dicek otomatis

- cli.server.id == id terpilih; cli.server.ip == 127.0.0.1 (bukti trick)
- cli ping/download/upload tercatat (> 0)
- clone summary.failed == 0 (10 check: dns, netgauge, websocket, version,
  crossdomain, https, upload, download, latency, keepalive)
- versi daemon konsisten: GET /hi vs versi HELLO netgauge di output clone
- verdict: KONSISTEN bila semua lolos, BELUM LENGKAP bila ada yang gagal
  (dengan alasan per item).

## Status

Menunggu eksekusi di mesin user: agent tidak dapat mengunduh/menjalankan
binary (sandbox tanpa network/ELF), jadi kit ini dirancang agar hasil
cross-validation nyata diperoleh di mesin user dan ditempelkan kembali
untuk analisis final oleh agent utama sebelum merge.
