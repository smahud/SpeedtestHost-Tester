# Log kunci simulasi

## HTTP mode — pid 7207

```
Loaded config file: /home/user/ooklaserver/sim/http/OoklaServer.properties
OoklaServer version 2.11 (2.11.5.2) build number 2026-06-04.1737.7d0993d
OoklaServer instance ID 47c99578-7303-4bdc-a410-0f5757672675
Generating 2097152 bytes of download data
Listening on TCP socket: 127.0.0.1:8080
TCP port: 8080 - current: 0, queued: 0, blocked: 0, queueFull: 0, concurrent: 0, currentThreads: 0
Server updates were disabled.
Listening on UDP socket: 127.0.0.1:8080
CA bundle is empty; skipping
...
[Warning] Can't accept TLS connection; TLS context is not initialized
```

## HTTPS mode — pid 7586

```
Loaded config file: /home/user/ooklaserver/sim/https/OoklaServer.properties
OoklaServer version 2.11 (2.11.5.2) build number 2026-06-04.1737.7d0993d
OoklaServer instance ID 294480e3-775d-4fbf-b10c-d56c36abd27c
Generating 2097152 bytes of download data
Listening on TCP socket: 127.0.0.1:8080
Server updates were disabled.
Listening on UDP socket: 127.0.0.1:8080
Initializing TLS context with provided certificate '/home/user/ooklaserver/sim/certs/fullchain.pem'
Successfully loaded certificate chain with 1 intermediate certificate(s)
Initializing TLS context with provided key '/home/user/ooklaserver/sim/certs/server.key'
Server is configured to require minimum TLS version of 1.2
CA bundle is empty; skipping
TLS context initialized using user-defined certificate <0a:c0:6f:87:b2:d9:0f:ab:ea:70:9e:c9:e0:d1:21:fa:ff:92:b6:ec>
```

## Legacy control — pid 7408

```
Legacy fallback listening on 127.0.0.1:80
legacy80 "GET /crossdomain.xml HTTP/1.1" 200 -
legacy80 "GET /speedtest/latency.txt HTTP/1.1" 200 -
legacy80 "POST /speedtest/upload.php HTTP/1.1" 200 -
```

## Catatan operasional

`stop_process` untuk HTTP mode melaporkan "stopped", tetapi `ps` masih menunjukkan pid 7207 dan port 8080 masih LISTEN. Perlu:

```bash
kill -TERM 7207 || true
kill -KILL 7207 2>/dev/null || true
```

Setelah itu port 8080 benar-benar bebas dan HTTPS mode bisa start.
