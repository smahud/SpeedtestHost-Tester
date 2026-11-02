/**
 * Mock OoklaServer daemon — faithful reproduction of the behaviors observed
 * from a real OoklaServer (used to verify the Host Tester engine end-to-end).
 *
 * Endpoints:
 *   GET  /                          -> OoklaServer "It worked!" page
 *   GET  /speedtest/latency.txt     -> "test=test" (10 bytes)
 *   HEAD /speedtest/random{n}x{n}.jpg -> random jpeg-ish payloads
 *   POST /speedtest/upload.php      -> "size=<received bytes>"
 *   GET  /crossdomain.xml           -> cross-domain policy
 *   WS   /ws                        -> netgauge protocol:
 *        "HI" -> "HELLO <version>"; "PING a b" -> "PONG <ts>";
 *        "UPLOAD <n>" -> read n bytes -> "OK <n> <ts>";
 *        "DOWNLOAD <n>" -> binary frame with n bytes
 */
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.argv[2] || 8091);
const VERSION = "2.11 (2.11.5-mock) 2026-06-04.1737.7d0993d";

const IMAGE_SIZES = {
  350: 245388, 500: 505544, 750: 1118012, 1000: 1986284, 1500: 4468241,
  2000: 7907740, 2500: 12407926, 3000: 17816816, 3500: 24262167, 4000: 31625365,
};

const imageCache = new Map();
function getImage(n) {
  if (!imageCache.has(n)) {
    const size = IMAGE_SIZES[n] || n * n * 2;
    const buf = Buffer.allocUnsafe(Math.min(size, 8 * 1024 * 1024));
    crypto.randomBytes(buf.length).copy(buf);
    // repeat-fill to reach the target size cheaply
    const out = Buffer.alloc(size);
    for (let i = 0; i < size; i += buf.length) buf.copy(out, i);
    imageCache.set(n, out);
  }
  return imageCache.get(n);
}

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; script-src 'none'; object-src 'none';  connect-src *",
};

/* ---------------- minimal websocket server ---------------- */

function serverFrame(opcode, payload) {
  let head;
  if (payload.length < 126) {
    head = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(payload.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([head, payload]);
}

function handleNetgauge(sock, messages) {
  // messages: array of {opcode, payload}
  for (const m of messages) {
    if (m.opcode !== 0x1) continue;
    const text = m.payload.toString("utf8").trim();
    if (text === "HI") {
      sock.write(serverFrame(0x1, Buffer.from(`HELLO ${VERSION}\n`)));
    } else if (text.startsWith("PING")) {
      sock.write(serverFrame(0x1, Buffer.from(`PONG ${Date.now()}\n`)));
    } else if (text.startsWith("DOWNLOAD")) {
      const n = parseInt(text.split(/\s+/)[1] || "0", 10);
      let remaining = n;
      const chunk = Buffer.alloc(Math.min(65536, Math.max(remaining, 0)));
      crypto.randomBytes(chunk.length).copy(chunk);
      const sendNext = () => {
        if (remaining <= 0 || sock.destroyed) return;
        const take = Math.min(chunk.length, remaining);
        remaining -= take;
        sock.write(serverFrame(0x2, chunk.subarray(0, take)), sendNext);
      };
      sendNext();
    } else if (text.startsWith("UPLOAD")) {
      // handled by the caller (needs byte counting state)
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === "/" || path === "") {
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/html", Connection: "Keep-Alive" });
    res.end(
      "<html><head><title>OoklaServer</title></head><body><h1>OoklaServer</h1><p>It worked!<br /></p></body></html>",
    );
    return;
  }

  if (path === "/speedtest/latency.txt") {
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=UTF-8", Connection: "Keep-Alive" });
    res.end("test=test\n");
    return;
  }

  const m = path.match(/^\/speedtest\/random(\d+)x(\d+)\.jpg$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (IMAGE_SIZES[n]) {
      const img = getImage(n);
      res.writeHead(200, {
        ...BASE_HEADERS,
        "Content-Type": "image/jpeg",
        "Content-Length": String(img.length),
        Connection: "Keep-Alive",
      });
      if (req.method === "HEAD") res.end();
      else res.end(img);
      return;
    }
    res.writeHead(404, { ...BASE_HEADERS, "Content-Type": "text/plain", Connection: "Keep-Alive" });
    res.end("Not Found");
    return;
  }

  if (path === "/speedtest/upload.php") {
    if (req.method !== "POST") {
      res.writeHead(404, { ...BASE_HEADERS, "Content-Type": "text/plain", Connection: "Keep-Alive" });
      res.end("Not Found");
      return;
    }
    let received = 0;
    req.on("data", (c) => { received += c.length; });
    req.on("end", () => {
      res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/plain", Connection: "Keep-Alive" });
      res.end(`size=${received}\n`);
    });
    return;
  }

  if (path === "/crossdomain.xml") {
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "application/xml", Connection: "Keep-Alive" });
    res.end(
      '<?xml version="1.0"?>\n' +
        "<!DOCTYPE cross-domain-policy SYSTEM " +
        '"http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">\n' +
        "<cross-domain-policy>\n" +
        '  <allow-access-from domain="*" to-ports="*" secure="false" />\n' +
        "</cross-domain-policy>\n",
    );
    return;
  }

  res.writeHead(404, { ...BASE_HEADERS, "Content-Type": "text/plain", Connection: "Keep-Alive" });
  res.end("Not Found");
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update((req.headers["sec-websocket-key"] || "") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);

  let buf = Buffer.from(head ?? []);
  let uploadRemaining = -1;

  const processFrame = (fin, opcode, payload) => {
    if (opcode === 0x1) {
      const text = payload.toString("utf8").trim();
      if (text === "HI") {
        socket.write(serverFrame(0x1, Buffer.from(`HELLO ${VERSION}\n`)));
      } else if (text.startsWith("PING")) {
        socket.write(serverFrame(0x1, Buffer.from(`PONG ${Date.now()}\n`)));
      } else if (text.startsWith("DOWNLOAD")) {
        const n = parseInt(text.split(/\s+/)[1] || "0", 10);
        const chunk = Buffer.alloc(Math.min(65536, Math.max(n, 1)));
        crypto.randomBytes(chunk.length).copy(chunk);
        let remaining = n;
        const sendNext = () => {
          if (remaining <= 0 || socket.destroyed) return;
          const take = Math.min(chunk.length, remaining);
          remaining -= take;
          socket.write(serverFrame(0x2, chunk.subarray(0, take)), sendNext);
        };
        sendNext();
      } else if (text.startsWith("UPLOAD")) {
        uploadRemaining = parseInt(text.split(/\s+/)[1] || "0", 10);
        if (uploadRemaining <= 0) {
          socket.write(serverFrame(0x1, Buffer.from(`OK 0 ${Date.now()}\n`)));
        }
      } else if (text.startsWith("DISCONNECT")) {
        socket.end();
      } else {
        socket.write(serverFrame(0x1, Buffer.from("ERROR\n")));
      }
    } else if (opcode === 0x2) {
      if (uploadRemaining > 0) {
        uploadRemaining -= payload.length;
        if (uploadRemaining <= 0) {
          socket.write(serverFrame(0x1, Buffer.from(`OK ${payload.length} ${Date.now()}\n`)));
          uploadRemaining = -1;
        }
      }
    } else if (opcode === 0x8) {
      socket.write(serverFrame(0x8, Buffer.alloc(0)));
      socket.end();
    }
  };

  const tryParse = () => {
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      let maskKey = null;
      if (masked) {
        if (buf.length < off + 4) return;
        maskKey = buf.subarray(off, off + 4);
        off += 4;
      }
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (maskKey) {
        const un = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ maskKey[i & 3];
        payload = un;
      }
      buf = buf.subarray(off + len);
      processFrame(fin, opcode, payload);
    }
  };

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    tryParse();
  });
  socket.on("error", () => socket.destroy());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-ooklaserver] listening on http://127.0.0.1:${PORT} (netgauge WS on /ws)`);
});
