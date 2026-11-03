# Referensi Protokol & Konfigurasi OoklaServer (dari sumber resmi)

Sumber utama: support.ookla.com (Using the Server Tester; Which Protocols and Ports; Advanced Server Daemon Configuration; OoklaServer.properties sample) + reverse engineering protokol (gist Gökberk Yaltıraklı, komentar 2023).

## Persyaratan port & jaringan (host publik speedtest.net)
- TCP/UDP **8080** dan **5060** wajib terbuka (8080 wajib untuk host publik).
- IPv6 (record AAAA) wajib; tester resmi mengetes `curl -4` dan `curl -6`.
- Outbound TCP 443 ke `*.speedtest.net` untuk auto-update & provision Let's Encrypt.
- Format input tester resmi: `host:port` (mis. `speedtest.domain.com:8080`) — BUKAN URL.

## Protokol netgauge (raw TCP di 8080, plaintext)
```
C: HI                      S: HELLO 2.9 (2.9.2) 2021-11-30.2159.ffae0e0   ← versi daemon
C: PING 1418661866099      S: PONG 1418661866349        ← 20x, ukur RTT
C: DOWNLOAD 1000000        S: tepat 1000000 byte, diawali "DOWNLOAD " lalu pola berulang "JABCDEFGHI"
C: UPLOAD 2000000 0        C: payload sepanjang n−len(command); S: OK 2000000 1697019361382
C: QUIT                                                 ← server menutup koneksi
```
- WebSocket: upgrade HTTP di port yang sama; frame maks 5 MB (`OoklaServer.websocket.frameSizeLimitBytes = 5242880`).
- `GET /hi` via HTTP di 8080 → versi daemon (cara resmi cek versi; `telnet host 8080` + `HI` juga bisa).

## Endpoint HTTP legacy (dilayani di port 8080; kutipan staff Ookla: "These files are reached over port 8080 and test exactly the same way")
- `/crossdomain.xml` → wajib `<allow-access-from domain="*"/>` (tester menampilkan `count` + daftar domain; jika bukan `*` muncul warning).
- `/upload.php?callback=test` → POST raw body; respons berisi `size=<bytes>` (legacy upload script).
- `/latency.txt` → file latency (RTT).
- `random500x500.jpg` … `random4000x4000.jpg` → file gambar download (validasi magic byte JPEG + ukuran).
- HTTP Legacy Fallback tambahan di webserver (Apache/nginx, port 80/443) tetap disyaratkan untuk klien yang port 8080-nya terblokir.

## OoklaServer.properties (kunci penting, sample resmi)
```
OoklaServer.tcpPorts = 8080            # default publik: 5060,8080
OoklaServer.udpPorts = 8080
OoklaServer.useIPv6 = true
OoklaServer.allowedDomains = *         # default; membatasi domain klien
OoklaServer.enableAutoUpdate = true
OoklaServer.websocket.frameSizeLimitBytes = 5242880
OoklaServer.http.maxHeadersSize = 65536
OoklaServer.clientAuthToken.denyInvalid = true   # token invalid ditolak; klien legacy tanpa token tetap boleh
OoklaServer.ssl.useLetsEncrypt = true  # provision otomatis SETELAH server disetujui Ookla
openSSL.server.certificateFile = cert.pem   # custom cert (mematikan Let's Encrypt); wajib full chain
openSSL.server.privateKeyFile  = key.pem
openSSL.server.minimumTLSProtocol = 1.2
# logging: ConsoleChannel / FileChannel (Poco), pattern %Y-%m-%d %H:%M:%S [%P - %I] [%p] %t
```
- TLS (https/wss) dilayani di **port yang sama** dengan plain — daemon membedakan per koneksi.
- HTTPS host baru: tes https di Server Tester boleh diabaikan sampai server disetujui (provision LE belum jalan).

## Binary resmi (stable, static-musl)
- x86_64: `https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz`
- aarch64: `https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-aarch64-static-musl.tgz`
- Installer resmi: `https://install.speedtest.net/ooklaserver/ooklaserver.sh` (`./ooklaserver.sh install`)
- Jalankan: `./OoklaServer --daemon` (tanpa flag = log ke console). Cek versi: `curl http://host:8080/hi`.
- Versi 2.11.x (2026): FreeBSD 14/15 build, minimumTLSProtocol default 1.2, HSTS redirect ke hostname valid.

## Penyebab umum gagal di tester resmi
- netgauge/websocket FAIL = server tidak terjangkau di 8080 (firewall/port tertutup).
- https FAIL = sertifikat self-signed/expired/chain tidak lengkap (wajib full chain di certificateFile).
- crossdomain FAIL/notice = `allowedDomains` bukan `*`.
- upload/download/latency FAIL = file legacy tidak tersedia di 8080 (atau webserver legacy di port 80 bermasalah, mis. upload.php tak dieksekusi PHP).
