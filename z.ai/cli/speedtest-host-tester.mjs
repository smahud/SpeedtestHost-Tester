#!/usr/bin/env node

// src/lib/host-tester.ts
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import dns from "node:dns";

// src/lib/host-tester-types.ts
var SPEEDTEST_IMAGE_SIZES = [
  350,
  500,
  750,
  1000,
  1500,
  2000,
  2500,
  3000,
  3500,
  4000
];
function speedtestImagePath(size) {
  return `/speedtest/random${size}x${size}.jpg`;
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}
function formatMbit(mbps) {
  if (!Number.isFinite(mbps) || mbps <= 0)
    return "0.00";
  return mbps.toFixed(2);
}

// src/lib/host-tester.ts
var now = () => performance.now();
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var randHex = (n = 8) => crypto.randomBytes(n).toString("hex");
var isAbortError = (e) => !!e && typeof e === "object" && e.name === "AbortError";
var isIpAddress = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
var errText = (e) => {
  const messages = [];
  let cur = e;
  let guard = 0;
  while (cur != null && guard++ < 6) {
    const c = cur;
    if (Array.isArray(c.errors) && c.errors.length > 0) {
      const sub = c.errors[0];
      const code = sub.code || c.code || "";
      const loc = sub.address ? `${sub.address}:${sub.port ?? ""}` : "";
      messages.push(`${code} ${loc}`.trim() || sub.message || c.message || "");
      break;
    }
    let m = c.message ?? (typeof cur === "string" ? cur : "");
    if (c.code && !m.includes(c.code)) {
      const loc = c.address ? `${c.address}:${c.port ?? ""} ` : "";
      m = `${c.code} ${loc}${m}`.trim();
    }
    if (m)
      messages.push(m);
    cur = c.cause;
  }
  const filtered = messages.filter((m) => m && m !== "fetch failed" && m !== "This operation was aborted");
  const out = (filtered.length > 0 ? filtered : messages).join(" · ");
  return out || "unknown error";
};
var RANDOM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BROWSER_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};
function randomChars(n) {
  const bytes = crypto.randomBytes(n);
  const parts = [];
  const CHUNK = 8192;
  for (let i = 0;i < n; i += CHUNK) {
    let s = "";
    const end = Math.min(n, i + CHUNK);
    for (let j = i;j < end; j++)
      s += RANDOM_ALPHABET[bytes[j] % RANDOM_ALPHABET.length];
    parts.push(s);
  }
  return parts.join("");
}

class SignalGroup {
  ac = new AbortController;
  timers = [];
  signals = [];
  onAbort = () => this.ac.abort();
  constructor(signals, timeoutMs) {
    for (const s of signals) {
      if (!s)
        continue;
      this.signals.push(s);
      if (s.aborted)
        this.ac.abort();
      else
        s.addEventListener("abort", this.onAbort, { once: true });
    }
    if (timeoutMs && timeoutMs > 0) {
      this.timers.push(setTimeout(() => this.ac.abort(), timeoutMs));
    }
  }
  get signal() {
    return this.ac.signal;
  }
  get aborted() {
    return this.ac.signal.aborted;
  }
  cleanup() {
    for (const t of this.timers)
      clearTimeout(t);
    for (const s of this.signals)
      s.removeEventListener("abort", this.onAbort);
  }
}
function parseTarget(raw) {
  let s = (raw || "").trim();
  if (!s)
    return null;
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  s = s.replace(/\/.*$/, "");
  s = s.replace(/\.+$/, "");
  let host = "";
  let port = 8080;
  if (s.startsWith("[")) {
    const m = s.match(/^\[([0-9a-fA-F:.%]+)\](?::(\d+))?$/);
    if (!m)
      return null;
    host = m[1];
    if (m[2])
      port = parseInt(m[2], 10);
  } else {
    const m = s.match(/^(.+):(\d+)$/);
    if (m) {
      host = m[1];
      port = parseInt(m[2], 10);
    } else {
      host = s;
    }
  }
  if (!host || port < 1 || port > 65535)
    return null;
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIPv6 = host.includes(":");
  const isHostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(host);
  if (!isIPv4 && !isIPv6 && !isHostname)
    return null;
  if (isIPv4 && host.split(".").some((p) => parseInt(p, 10) > 255))
    return null;
  return { host, port };
}
function wsClientFrame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0;i < payload.length; i++)
    masked[i] = payload[i] ^ mask[i & 3];
  let head;
  if (payload.length < 126) {
    head = Buffer.from([128 | opcode, 128 | payload.length]);
  } else if (payload.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 128 | opcode;
    head[1] = 128 | 126;
    head.writeUInt16BE(payload.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 128 | opcode;
    head[1] = 128 | 127;
    head.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([head, mask, masked]);
}
function wsConnect(opts) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const mod = opts.secure ? https : http;
    const options = {
      host: opts.host,
      port: opts.port,
      path: opts.path ?? "/ws",
      method: "GET",
      timeout: opts.timeoutMs ?? 8000,
      headers: {
        Host: `${opts.host}:${opts.port}`,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
        "User-Agent": BROWSER_UA
      },
      ...opts.secure ? { rejectUnauthorized: false, ...isIpAddress(opts.host) ? {} : { servername: opts.host } } : {}
    };
    const req = mod.request(options);
    req.on("timeout", () => req.destroy(new Error("websocket connection timeout")));
    req.on("error", (e) => reject(e));
    req.on("response", (res) => {
      res.resume();
      reject(new Error(`server did not upgrade to websocket (HTTP ${res.statusCode})`));
    });
    req.on("upgrade", (_res, socket, head) => {
      socket.setNoDelay(true);
      let buf = Buffer.from(head ?? []);
      const queue = [];
      let waiter = null;
      const fragParts = [];
      let fragOpcode = 0;
      let closed = false;
      const failWaiter = (e) => {
        if (waiter) {
          clearTimeout(waiter.timer);
          const w = waiter;
          waiter = null;
          w.reject(e);
        }
      };
      const deliver = (text) => {
        if (waiter) {
          clearTimeout(waiter.timer);
          const w = waiter;
          waiter = null;
          w.resolve(text);
        } else {
          queue.push(text);
        }
      };
      const handleFrame = (fin, opcode, payload) => {
        if (opcode === 1 || opcode === 2) {
          if (fin && fragParts.length === 0) {
            deliver(payload.toString("utf8"));
          } else {
            fragOpcode = opcode;
            fragParts.push(payload);
            if (fin) {
              const full = Buffer.concat(fragParts);
              fragParts.length = 0;
              if (fragOpcode === 1)
                deliver(full.toString("utf8"));
            }
          }
        } else if (opcode === 0) {
          fragParts.push(payload);
          if (fin) {
            const full = Buffer.concat(fragParts);
            fragParts.length = 0;
            if (fragOpcode === 1)
              deliver(full.toString("utf8"));
          }
        } else if (opcode === 8) {
          try {
            socket.write(wsClientFrame(8, Buffer.alloc(0)));
          } catch {}
          socket.destroy();
          failWaiter(new Error("websocket closed by server"));
        } else if (opcode === 9) {
          try {
            socket.write(wsClientFrame(10, payload));
          } catch {}
        }
      };
      const tryParse = () => {
        for (;; ) {
          if (buf.length < 2)
            return;
          const b0 = buf[0];
          const b1 = buf[1];
          const fin = (b0 & 128) !== 0;
          const opcode = b0 & 15;
          const masked = (b1 & 128) !== 0;
          let len = b1 & 127;
          let off = 2;
          if (len === 126) {
            if (buf.length < 4)
              return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            if (buf.length < 10)
              return;
            const big = buf.readBigUInt64BE(2);
            if (big > BigInt(64 * 1024 * 1024)) {
              socket.destroy();
              failWaiter(new Error("websocket frame too large"));
              return;
            }
            len = Number(big);
            off = 10;
          }
          let maskKey = null;
          if (masked) {
            if (buf.length < off + 4)
              return;
            maskKey = buf.subarray(off, off + 4);
            off += 4;
          }
          if (buf.length < off + len)
            return;
          let payload = buf.subarray(off, off + len);
          if (maskKey) {
            const un = Buffer.allocUnsafe(len);
            for (let i = 0;i < len; i++)
              un[i] = payload[i] ^ maskKey[i & 3];
            payload = un;
          }
          buf = buf.subarray(off + len);
          handleFrame(fin, opcode, payload);
        }
      };
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        tryParse();
      });
      socket.on("error", (e) => failWaiter(e));
      socket.on("close", () => failWaiter(new Error("websocket connection closed")));
      resolve({
        sendText(s) {
          socket.write(wsClientFrame(1, Buffer.from(s, "utf8")));
        },
        nextText(timeoutMs) {
          if (queue.length > 0)
            return Promise.resolve(queue.shift());
          if (closed)
            return Promise.reject(new Error("websocket closed"));
          return new Promise((res2, rej2) => {
            const timer = setTimeout(() => {
              waiter = null;
              rej2(new Error("websocket response timeout"));
            }, timeoutMs);
            waiter = { resolve: res2, reject: rej2, timer };
          });
        },
        close() {
          if (closed)
            return;
          closed = true;
          try {
            socket.write(wsClientFrame(8, Buffer.from([3, 232])));
          } catch {}
          socket.destroy();
        }
      });
    });
    req.end();
  });
}
async function netgaugeProbe(host, port, pings, signal) {
  let lastErr = "unknown error";
  for (const secure of [true, false]) {
    let conn = null;
    try {
      const g = new SignalGroup([signal], 1e4);
      try {
        conn = await wsConnect({ host, port, secure, path: "/ws", timeoutMs: 8000 });
        conn.sendText(`HI
`);
        const hello = await conn.nextText(4000);
        if (!/^HELLO\b/.test(hello))
          throw new Error(`unexpected handshake: ${hello.slice(0, 60)}`);
        const version = hello.replace(/^HELLO\s*/, "").trim();
        const rtts = [];
        for (let i = 0;i < pings; i++) {
          const t0 = now();
          conn.sendText(`PING 0 100
`);
          const pong = await conn.nextText(3000);
          if (!/^PONG\b/.test(pong))
            throw new Error(`unexpected ping reply: ${pong.slice(0, 60)}`);
          rtts.push(now() - t0);
        }
        return { ok: true, secure, version, rtts };
      } finally {
        try {
          conn?.close();
        } catch {}
        g.cleanup();
      }
    } catch (e) {
      lastErr = errText(e);
    }
  }
  return { ok: false, error: lastErr };
}
function httpsCheck(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, detail) => {
      if (!settled) {
        settled = true;
        resolve({ ok, detail });
      }
    };
    let tlsInfo = "";
    const req = https.request({
      host,
      port,
      path: "/",
      method: "GET",
      rejectUnauthorized: false,
      ...isIpAddress(host) ? {} : { servername: host },
      timeout: timeoutMs,
      headers: { "User-Agent": BROWSER_UA }
    }, (res) => {
      res.resume();
      const statusOk = (res.statusCode ?? 0) > 0;
      done(statusOk, `HTTPS ${res.statusCode ?? "???"}${tlsInfo ? ` · ${tlsInfo}` : ""}`);
    });
    req.on("socket", (sock) => {
      sock.on("secureConnect", () => {
        try {
          const cert = sock.getPeerCertificate();
          const proto = typeof sock.getProtocol === "function" ? sock.getProtocol() : "";
          const cn = cert && cert.subject && (cert.subject.CN || cert.subject.O) || "self-signed/unknown";
          let exp = "";
          if (cert && cert.valid_to) {
            const days = Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
            exp = `, valid ${days}d`;
          }
          tlsInfo = `${proto}, CN=${cn}${exp}`;
        } catch {}
      });
    });
    req.on("timeout", () => req.destroy(new Error("HTTPS connection timeout")));
    req.on("error", (e) => done(false, e.message));
    req.end();
  });
}
async function fetchCheck(url, init, group) {
  return fetch(url, {
    ...init,
    signal: group.signal,
    cache: "no-store",
    headers: { ...BROWSER_HEADERS, ...init.headers }
  });
}
async function runHostTest(input, handlers = {}, options = {}) {
  const { onEvent = () => {}, signal } = handlers;
  const opts = {
    downloadSeconds: 10,
    uploadSeconds: 10,
    latencySamples: 10,
    netgaugePings: 5,
    timeoutMs: 150000,
    ...options
  };
  const emit = (e) => {
    try {
      onEvent(e);
    } catch {}
  };
  const parsed = parseTarget(input);
  if (!parsed) {
    const msg = "Invalid hostname format. Use hostname:port (e.g. speedtest.example.com:8080).";
    emit({ type: "error", message: msg });
    throw new Error(msg);
  }
  const { host, port } = parsed;
  const target = `${host}:${port}`;
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const base = `http://${urlHost}:${port}`;
  const startedAt = Date.now();
  const watchdog = new SignalGroup([signal], opts.timeoutMs);
  const globalSignal = watchdog.signal;
  emit({ type: "start", target, host, port });
  const checks = [];
  const runCheck = async (id, name, fn) => {
    emit({ type: "check", check: { id, name, status: "running" } });
    const t0 = now();
    let result;
    try {
      result = await fn();
    } catch (e) {
      result = { status: "fail", detail: errText(e) };
    }
    const full = { id, name, durationMs: Math.round(now() - t0), ...result };
    checks.push(full);
    emit({ type: "check", check: full });
    return full;
  };
  let ip;
  await runCheck("resolution", "Hostname resolution", async () => {
    try {
      const r = await dns.promises.lookup(host, { family: 0 });
      ip = r.address;
      emit({ type: "ip", ip: r.address });
      return { status: "pass", detail: r.address };
    } catch (e) {
      return { status: "fail", detail: `DNS lookup failed: ${errText(e)}` };
    }
  });
  let rootHeaders = null;
  let rootOk = false;
  await runCheck("daemon", "OoklaServer daemon connection", async () => {
    const g = new SignalGroup([globalSignal], 1e4);
    try {
      const res = await fetchCheck(`${base}/`, { method: "GET" }, g);
      rootHeaders = res.headers;
      rootOk = res.ok || res.status < 500;
      const body = (await res.text()).slice(0, 512);
      const server = res.headers.get("server") || "";
      const isOokla = /ooklaserver/i.test(body) || /ooklaserver/i.test(server);
      if (isOokla) {
        return { status: "pass", detail: `OoklaServer daemon detected (HTTP ${res.status})` };
      }
      return {
        status: rootOk ? "warn" : "fail",
        detail: rootOk ? `HTTP ${res.status} — daemon banner not identified` : `HTTP ${res.status}`
      };
    } finally {
      g.cleanup();
    }
  });
  emit({ type: "phase", phase: "netgauge", status: "start" });
  const ng = await netgaugeProbe(host, port, opts.netgaugePings, globalSignal);
  emit({ type: "phase", phase: "netgauge", status: "end" });
  await runCheck("daemon-version", "OoklaServer daemon version", async () => {
    if (ng.ok && ng.version) {
      return { status: "pass", detail: ng.version };
    }
    return { status: "fail", detail: `version unavailable — netgauge handshake failed (${ng.error ?? "unknown"})` };
  });
  await runCheck("netgauge", "Netgauge / WebSocket (port " + port + ")", async () => {
    if (ng.ok) {
      const rtt = ng.rtts && ng.rtts.length ? Math.min(...ng.rtts).toFixed(1) : "—";
      const scheme = ng.secure ? "wss" : "ws";
      return {
        status: "pass",
        detail: `${scheme}://${target}/ws · HI→HELLO, PING→PONG ok, ws ping ${rtt} ms`
      };
    }
    return { status: "fail", detail: ng.error ?? "netgauge websocket unreachable" };
  });
  await runCheck("https", "HTTPS functionality", async () => {
    const r = await httpsCheck(host, port, 8000);
    return { status: r.ok ? "pass" : "fail", detail: r.detail };
  });
  await runCheck("keepalive", "Keep-Alive", async () => {
    const conn = rootHeaders?.get("connection") ?? "";
    if (!rootHeaders)
      return { status: "fail", detail: "no HTTP response to inspect" };
    const ok = /keep-alive/i.test(conn);
    return {
      status: ok ? "pass" : "fail",
      detail: ok ? `Connection: ${conn}` : `Connection: ${conn || "(none)"}`
    };
  });
  let latencyFileOk = false;
  await runCheck("latency-file", "Latency file (speedtest/latency.txt)", async () => {
    const g = new SignalGroup([globalSignal], 8000);
    try {
      const res = await fetchCheck(`${base}/speedtest/latency.txt`, { method: "GET" }, g);
      const body = (await res.text()).slice(0, 64);
      if (res.ok && body.length > 0) {
        latencyFileOk = true;
        return { status: "pass", detail: `HTTP 200 · ${JSON.stringify(body)}` };
      }
      return { status: "fail", detail: `HTTP ${res.status}${body ? ` · ${JSON.stringify(body)}` : ""}` };
    } finally {
      g.cleanup();
    }
  });
  const imageSizes = [];
  await runCheck("images", "Download image files (random*.jpg)", async () => {
    const g = new SignalGroup([globalSignal], 8000);
    try {
      for (const s of SPEEDTEST_IMAGE_SIZES) {
        let bytes = null;
        let status = 0;
        try {
          const res = await fetchCheck(`${base}${speedtestImagePath(s)}`, { method: "HEAD" }, g);
          status = res.status;
          const cl = res.headers.get("content-length");
          bytes = cl ? parseInt(cl, 10) : null;
          if (res.status === 405 || res.ok && bytes == null) {
            const res2 = await fetchCheck(`${base}${speedtestImagePath(s)}`, { method: "GET" }, g);
            const buf = await res2.arrayBuffer();
            bytes = buf.byteLength;
            status = res2.status;
          }
        } catch (e) {
          if (isAbortError(e))
            throw e;
        }
        imageSizes.push({ size: s, bytes: res_ok(status) ? bytes : null });
      }
    } finally {
      g.cleanup();
    }
    const found = imageSizes.filter((i) => i.bytes != null);
    if (found.length === 0) {
      return { status: "fail", detail: "no download images found" };
    }
    const missing = imageSizes.filter((i) => i.bytes == null).map((i) => `${i.size}x${i.size}`);
    const range = `${formatBytes(found[0].bytes)} – ${formatBytes(found[found.length - 1].bytes)}`;
    if (found.length < imageSizes.length) {
      return { status: "fail", detail: `${found.length}/${imageSizes.length} files · missing: ${missing.join(", ")}` };
    }
    return { status: "pass", detail: `${found.length}/${imageSizes.length} files (${range})` };
  });
  let uploadScriptOk = false;
  await runCheck("upload-script", "Legacy HTTP upload script (upload.php)", async () => {
    const g = new SignalGroup([globalSignal], 8000);
    try {
      const probe = `content1=${randomChars(256)}`;
      const res = await fetchCheck(`${base}/speedtest/upload.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": String(Buffer.byteLength(probe))
        },
        body: probe
      }, g);
      const body = (await res.text()).slice(0, 128);
      if (res.ok && /^size=\d+/i.test(body)) {
        uploadScriptOk = true;
        return { status: "pass", detail: `HTTP 200 · ${body.trim()}` };
      }
      return { status: "fail", detail: `HTTP ${res.status}${body ? ` · ${body.trim()}` : ""}` };
    } finally {
      g.cleanup();
    }
  });
  await runCheck("crossdomain", "Crossdomain settings (crossdomain.xml)", async () => {
    const g = new SignalGroup([globalSignal], 8000);
    try {
      const res = await fetchCheck(`${base}/crossdomain.xml`, { method: "GET" }, g);
      const body = (await res.text()).slice(0, 512);
      if (res.ok && /cross-domain-policy|allow-access-from/i.test(body)) {
        return { status: "pass", detail: "HTTP 200 · policy found" };
      }
      return { status: "fail", detail: `HTTP ${res.status}` };
    } finally {
      g.cleanup();
    }
  });
  let netgaugePing;
  let httpPing;
  if (latencyFileOk && !globalSignal.aborted) {
    emit({ type: "phase", phase: "latency", status: "start" });
    const samples = [];
    for (let i = 0;i < opts.latencySamples; i++) {
      if (globalSignal.aborted)
        break;
      const g = new SignalGroup([globalSignal], 5000);
      try {
        const t0 = now();
        const res = await fetchCheck(`${base}/speedtest/latency.txt?ck=${randHex(8)}`, { method: "GET", headers: { "Cache-Control": "no-cache" } }, g);
        await res.text();
        const dt = now() - t0;
        samples.push(dt);
        emit({ type: "ping-sample", ms: Math.round(dt), index: i + 1, total: opts.latencySamples });
      } catch (e) {
        if (isAbortError(e))
          break;
      } finally {
        g.cleanup();
      }
      await sleep(60);
    }
    httpPing = stats(samples, "HTTP latency.txt");
    emit({ type: "phase", phase: "latency", status: "end" });
  }
  if (ng.ok && ng.rtts && ng.rtts.length > 0 && !globalSignal.aborted) {
    netgaugePing = stats(ng.rtts, "netgauge WebSocket PING");
  }
  let download;
  const imagesAvailable = imageSizes.some((i) => i.bytes != null);
  if (imagesAvailable && !globalSignal.aborted) {
    emit({ type: "phase", phase: "download", status: "start" });
    try {
      download = await downloadPhase(base, opts.downloadSeconds, globalSignal, emit);
    } catch (e) {
      if (!isAbortError(e))
        emit({ type: "log", message: `Download test failed: ${errText(e)}` });
    }
    emit({ type: "phase", phase: "download", status: "end" });
  } else if (!imagesAvailable) {
    emit({ type: "log", message: "Download test skipped: no download images available" });
  }
  let upload;
  if (uploadScriptOk && !globalSignal.aborted) {
    emit({ type: "phase", phase: "upload", status: "start" });
    try {
      upload = await uploadPhase(base, opts.uploadSeconds, globalSignal, emit);
    } catch (e) {
      if (!isAbortError(e))
        emit({ type: "log", message: `Upload test failed: ${errText(e)}` });
    }
    emit({ type: "phase", phase: "upload", status: "end" });
  } else if (!uploadScriptOk) {
    emit({ type: "log", message: "Upload test skipped: upload.php not usable" });
  }
  const failed = checks.filter((c) => c.status === "fail");
  const passedCount = checks.filter((c) => c.status === "pass").length;
  const summary = {
    target,
    host,
    port,
    ip,
    daemonVersion: ng.ok ? ng.version : undefined,
    checks,
    ping: netgaugePing ?? httpPing,
    netgaugePing,
    httpPing,
    download,
    upload,
    verdict: {
      ok: failed.length === 0,
      message: failed.length === 0 ? "Server is publicly available and properly configured." : "Server configuration issues detected.",
      failed: failed.map((c) => c.name),
      passedCount,
      failedCount: failed.length
    },
    startedAt,
    finishedAt: Date.now(),
    durationMs: Date.now() - startedAt
  };
  watchdog.cleanup();
  emit({ type: "done", summary });
  return summary;
}
function res_ok(status) {
  return status >= 200 && status < 300;
}
function stats(samples, method) {
  if (!samples.length)
    return;
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  let jitterSum = 0;
  for (let i = 1;i < samples.length; i++)
    jitterSum += Math.abs(samples[i] - samples[i - 1]);
  const jitter = samples.length > 1 ? jitterSum / (samples.length - 1) : 0;
  return {
    min: Math.round(min * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    max: Math.round(max * 10) / 10,
    jitter: Math.round(jitter * 10) / 10,
    samples: samples.length,
    method
  };
}
async function timedDownload(url, onBytes, group) {
  const res = await fetch(url, {
    signal: group.signal,
    cache: "no-store",
    headers: { ...BROWSER_HEADERS, "Cache-Control": "no-cache" }
  });
  if (!res.ok || !res.body)
    throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  let bytes = 0;
  for (;; ) {
    const { done, value } = await reader.read();
    if (done)
      break;
    if (value) {
      bytes += value.byteLength;
      onBytes(value.byteLength);
    }
    if (group.aborted) {
      try {
        await reader.cancel();
      } catch {}
      throw new Error("aborted");
    }
  }
  return bytes;
}
async function downloadPhase(base, seconds, parentSignal, emit) {
  let estimate = 0;
  {
    const g2 = new SignalGroup([parentSignal], 15000);
    try {
      const t0 = now();
      const bytes = await timedDownload(`${base}${speedtestImagePath(500)}?ck=${randHex(8)}`, () => {}, g2);
      estimate = bytes * 8 / 1e6 / ((now() - t0) / 1000);
    } catch {
      estimate = 0;
    } finally {
      g2.cleanup();
    }
  }
  const threads = estimate >= 4 ? 4 : 2;
  const file = estimate < 10 ? 1500 : estimate < 50 ? 2000 : estimate < 150 ? 3000 : 4000;
  const g = new SignalGroup([parentSignal], seconds * 1000 + 500);
  let totalBytes = 0;
  const tickSamples = [];
  const startT = now();
  const deadline = startT + seconds * 1000;
  let ticker = null;
  let lastTickT = startT;
  let lastTickBytes = 0;
  ticker = setInterval(() => {
    const t = now();
    const dBytes = totalBytes - lastTickBytes;
    const dMs = t - lastTickT;
    lastTickT = t;
    lastTickBytes = totalBytes;
    if (dMs <= 0)
      return;
    tickSamples.push({ bytes: dBytes, ms: dMs });
    const mbps2 = dBytes * 8 / 1e6 / (dMs / 1000);
    const progress = Math.min(1, (t - startT) / (seconds * 1000));
    emit({ type: "speed", phase: "download", mbps: mbps2, progress });
  }, 250);
  const worker = async (id) => {
    while (now() < deadline && !g.aborted) {
      const url = `${base}${speedtestImagePath(file)}?ck=${randHex(8)}&t=${id}`;
      try {
        await timedDownload(url, (n) => {
          totalBytes += n;
        }, g);
      } catch {
        if (g.aborted)
          return;
        try {
          await timedDownload(`${base}${speedtestImagePath(750)}?ck=${randHex(8)}`, (n) => {
            totalBytes += n;
          }, g);
        } catch {
          return;
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: threads }, (_, i) => worker(i)));
  } finally {
    if (ticker)
      clearInterval(ticker);
    g.cleanup();
  }
  const endT = now();
  const elapsedMs = endT - startT;
  if (totalBytes === 0 || elapsedMs <= 0)
    return;
  const seconds2 = elapsedMs / 1000;
  const speeds = tickSamples.filter((s) => s.ms >= 50).map((s) => s.bytes * 8 / 1e6 / (s.ms / 1000)).sort((a, b) => a - b);
  let mbps;
  if (speeds.length < 8) {
    mbps = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  } else {
    const noTop2 = speeds.slice(0, speeds.length - 2);
    const cut = Math.floor(noTop2.length / 4);
    const kept = noTop2.slice(cut);
    mbps = kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0;
  }
  const overall = totalBytes * 8 / 1e6 / seconds2;
  const final = mbps > 0 && Math.abs(mbps - overall) / (overall || 1) < 0.5 ? mbps : overall;
  return {
    mbps: Math.round(final * 100) / 100,
    bytes: totalBytes,
    seconds: Math.round(seconds2 * 10) / 10,
    threads,
    detail: `${threads} threads · random${file}x${file}.jpg · ${formatBytes(totalBytes)} in ${seconds2.toFixed(1)}s`
  };
}
async function timedUpload(url, body, group) {
  const t0 = now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(body))
    },
    body,
    signal: group.signal,
    cache: "no-store"
  });
  const text = await res.text();
  const seconds = (now() - t0) / 1000;
  const m = text.match(/^size=(\d+)/im);
  return { seconds, confirmed: m ? parseInt(m[1], 10) : null };
}
async function uploadPhase(base, seconds, parentSignal, emit) {
  const uploadUrl = `${base}/speedtest/upload.php`;
  const preSize = 256 * 1024;
  let estimate = 0;
  {
    const g2 = new SignalGroup([parentSignal], 20000);
    try {
      const body2 = `content1=${randomChars(preSize - 9)}`;
      const r = await timedUpload(`${uploadUrl}?ck=${randHex(8)}`, body2, g2);
      estimate = preSize * 8 / 1e6 / Math.max(r.seconds, 0.001);
    } catch {
      estimate = 0;
    } finally {
      g2.cleanup();
    }
  }
  const threads = estimate >= 4 ? 4 : 2;
  const chunkSize = estimate < 10 ? 1 << 20 : estimate < 50 ? 2 << 20 : 4 << 20;
  const body = `content1=${randomChars(chunkSize - 9)}`;
  const g = new SignalGroup([parentSignal], seconds * 1000 + 30000);
  const startT = now();
  const deadline = startT + seconds * 1000;
  const chunkSpeeds = [];
  let totalBytes = 0;
  let ticker = null;
  ticker = setInterval(() => {
    const progress = Math.min(1, (now() - startT) / (seconds * 1000));
    if (chunkSpeeds.length) {
      const recent = chunkSpeeds.slice(-threads * 2);
      const mbps2 = recent.reduce((a, b) => a + b, 0) / recent.length;
      emit({ type: "speed", phase: "upload", mbps: mbps2, progress });
    } else {
      emit({ type: "speed", phase: "upload", mbps: 0, progress });
    }
  }, 250);
  const worker = async (id) => {
    while (now() < deadline && !g.aborted) {
      try {
        const r = await timedUpload(`${uploadUrl}?ck=${randHex(8)}&t=${id}`, body, g);
        totalBytes += chunkSize;
        if (r.seconds > 0.01) {
          chunkSpeeds.push(chunkSize * 8 / 1e6 / r.seconds);
        }
      } catch (e) {
        if (isAbortError(e) || g.aborted)
          return;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: threads }, (_, i) => worker(i)));
  } finally {
    if (ticker)
      clearInterval(ticker);
    g.cleanup();
  }
  const elapsedMs = now() - startT;
  if (totalBytes === 0 || elapsedMs <= 0)
    return;
  const seconds2 = elapsedMs / 1000;
  const sorted = [...chunkSpeeds].sort((a, b) => a - b);
  const fastestHalf = sorted.slice(Math.floor(sorted.length / 2));
  const mbps = fastestHalf.length > 0 ? fastestHalf.reduce((a, b) => a + b, 0) / fastestHalf.length : 0;
  return {
    mbps: Math.round(mbps * 100) / 100,
    bytes: totalBytes,
    seconds: Math.round(seconds2 * 10) / 10,
    threads,
    detail: `${threads} threads · ${formatBytes(chunkSize)} chunks · ${formatBytes(totalBytes)} in ${seconds2.toFixed(1)}s`
  };
}

// src/cli/main.ts
var VERSION = "1.0.1";
function parseArgs(argv) {
  const args = {
    target: null,
    json: false,
    color: process.stdout.isTTY !== false,
    download: 10,
    upload: 10,
    samples: 10,
    timeout: 150,
    help: false
  };
  const rest = [];
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--json":
        args.json = true;
        break;
      case "--no-color":
        args.color = false;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--download":
        args.download = num(argv[++i], "download");
        break;
      case "--upload":
        args.upload = num(argv[++i], "upload");
        break;
      case "--samples":
        args.samples = num(argv[++i], "samples");
        break;
      case "--timeout":
        args.timeout = num(argv[++i], "timeout");
        break;
      default:
        if (a.startsWith("--")) {
          fail(`unknown option: ${a}`);
        }
        rest.push(a);
    }
  }
  args.target = rest.length > 0 ? rest[0] : null;
  return args;
}
function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0)
    fail(`invalid value for --${name}: ${v}`);
  return n;
}
function fail(msg) {
  process.stderr.write(`Error: ${msg}
Run with --help for usage.
`);
  process.exit(2);
}
var USE_COLOR = true;
var c = {
  reset: () => USE_COLOR ? "\x1B[0m" : "",
  dim: (s) => USE_COLOR ? `\x1B[2m${s}\x1B[0m` : s,
  bold: (s) => USE_COLOR ? `\x1B[1m${s}\x1B[0m` : s,
  green: (s) => USE_COLOR ? `\x1B[32m${s}\x1B[0m` : s,
  red: (s) => USE_COLOR ? `\x1B[31m${s}\x1B[0m` : s,
  yellow: (s) => USE_COLOR ? `\x1B[33m${s}\x1B[0m` : s,
  violet: (s) => USE_COLOR ? `\x1B[35m${s}\x1B[0m` : s,
  cyan: (s) => USE_COLOR ? `\x1B[36m${s}\x1B[0m` : s
};
function write(s) {
  process.stdout.write(s);
}
function clearLine() {
  write("\r\x1B[2K");
}
function printHelp() {
  const txt = `Speedtest Host Tester v${VERSION}

Validates an Ookla(R) Speedtest server the same way speedtest.net's
Server Tester does — from your terminal.

Usage:
  speedtest-host-tester <hostname[:port]> [options]
  node speedtest-host-tester.mjs <hostname[:port]> [options]

The port defaults to 8080 when omitted.

Options:
  --json             Print a machine-readable JSON summary only
  --no-color         Disable ANSI colors
  --download <sec>   Download test duration in seconds (default 10)
  --upload <sec>     Upload test duration in seconds (default 10)
  --samples <n>      Latency samples (default 10)
  --timeout <sec>    Global timeout in seconds (default 150)
  -h, --help         Show this help

Examples:
  speedtest-host-tester host.example.com:8080
  speedtest-host-tester host.example.com
  speedtest-host-tester host.example.com:8080 --json
  speedtest-host-tester host.example.com --download 5 --upload 5

Exit codes:
  0  all checks passed
  1  one or more checks failed (or a test error occurred)
  2  invalid usage
`;
  write(txt);
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  USE_COLOR = args.color;
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.target) {
    printHelp();
    return 2;
  }
  const parsed = parseTarget(args.target);
  if (!parsed) {
    fail(`invalid hostname format: "${args.target}" — use hostname[:port], e.g. speedtest.example.com:8080`);
  }
  const ctrl = new AbortController;
  const onSigint = () => {
    ctrl.abort();
  };
  process.on("SIGINT", onSigint);
  let spinnerTimer = null;
  let spinnerLabel = "";
  let lastSpeedLine = "";
  if (!args.json) {
    write(`
`);
    write(`  ${c.bold("Speedtest Host Tester")} ${c.dim(`v${VERSION}`)}
`);
    write(`  ${c.dim("Ookla Server validation — same checks as speedtest.net/host-tester")}
`);
    write(`
`);
    write(`  Target   ${c.cyan(parsed.host + ":" + parsed.port)}
`);
    write(`  Started  ${c.dim(new Date().toLocaleString())}
`);
    write(`
`);
  }
  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
      clearLine();
    }
  };
  const startSpinner = (label) => {
    if (args.json)
      return;
    stopSpinner();
    spinnerLabel = label;
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    spinnerTimer = setInterval(() => {
      write(`\r\x1B[2K  ${c.cyan(frames[i++ % frames.length])} ${label}`);
    }, 90);
  };
  try {
    const summary = await runHostTest(args.target, {
      signal: ctrl.signal,
      onEvent: (ev) => {
        if (ev.type === "check") {
          const ck = ev.check;
          if (ck.status === "running") {
            startSpinner(ck.name);
            return;
          }
          stopSpinner();
          if (!args.json)
            printCheck(ck.name, ck.status, ck.detail, ck.durationMs);
        } else if (ev.type === "ip") {
          if (!args.json) {
            const label = spinnerLabel;
            stopSpinner();
            write(`  IP       ${c.dim(ev.ip)}
`);
            if (label)
              startSpinner(label);
          }
        } else if (ev.type === "phase") {
          if (ev.phase === "download" || ev.phase === "upload") {
            if (ev.status === "start") {
              lastSpeedLine = "";
            } else {
              if (!args.json && lastSpeedLine) {
                clearLine();
                lastSpeedLine = "";
                write(`
`);
              }
            }
          }
        } else if (ev.type === "speed" && !args.json) {
          const barLen = 24;
          const filled = Math.round(ev.progress * barLen);
          const bar = "█".repeat(filled) + c.dim("░".repeat(barLen - filled));
          const icon = ev.phase === "download" ? "↓" : "↑";
          const col = ev.phase === "download" ? c.green : c.violet;
          const line = `  ${col(icon)} ${ev.phase === "download" ? "Download" : "Upload  "}` + `  ${c.bold(ev.mbps.toFixed(2).padStart(8))} Mbps  ${bar} ${Math.round(ev.progress * 100)}%`;
          write("\r\x1B[2K" + line);
          lastSpeedLine = line;
        } else if (ev.type === "log" && !args.json) {
          if (lastSpeedLine) {
            clearLine();
            lastSpeedLine = "";
          }
          write(`  ${c.dim("· " + ev.message)}
`);
        }
      }
    }, {
      downloadSeconds: args.download,
      uploadSeconds: args.upload,
      latencySamples: args.samples,
      timeoutMs: args.timeout * 1000
    });
    stopSpinner();
    process.off("SIGINT", onSigint);
    if (args.json) {
      write(JSON.stringify(summary, null, 2) + `
`);
      return summary.verdict.ok ? 0 : 1;
    }
    write(`
`);
    const ping = summary.ping;
    write(`  ${c.yellow("Ping")}     ${c.bold(String(ping ? ping.min.toFixed(1) : "—").padStart(9))} ms`);
    if (ping)
      write(c.dim(`   min ${ping.min} / avg ${ping.avg} / jitter ${ping.jitter} (${ping.samples} samples, ${ping.method})`));
    write(`
`);
    const dl = summary.download;
    write(`  ${c.green("Download")}${c.bold(String(dl ? formatMbit(dl.mbps) : "—").padStart(9))} Mbps`);
    if (dl)
      write(c.dim(`   ${dl.detail}`));
    write(`
`);
    const ul = summary.upload;
    write(`  ${c.violet("Upload")}  ${c.bold(String(ul ? formatMbit(ul.mbps) : "—").padStart(9))} Mbps`);
    if (ul)
      write(c.dim(`   ${ul.detail}`));
    write(`
`);
    write(`  ${c.dim("Traffic")}  ${formatBytes((dl?.bytes ?? 0) + (ul?.bytes ?? 0))} transferred in ${(summary.durationMs / 1000).toFixed(1)}s
`);
    write(`
`);
    if (summary.verdict.ok) {
      write(`  ${c.green(c.bold("✔ " + summary.verdict.message))}

`);
    } else {
      write(`  ${c.red(c.bold("✘ " + summary.verdict.message))}
`);
      for (const f of summary.verdict.failed)
        write(`    ${c.red("•")} ${f}
`);
      write(`
`);
    }
    write(`  ${c.dim(`${summary.verdict.passedCount} passed / ${summary.verdict.failedCount} failed · ${summary.target}`)}

`);
    return summary.verdict.ok ? 0 : 1;
  } catch (e) {
    stopSpinner();
    process.off("SIGINT", onSigint);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted") || e instanceof Error && e.name === "AbortError" || ctrl.signal.aborted) {
      if (!args.json)
        write(`
  Aborted.

`);
      return 130;
    }
    if (args.json) {
      write(JSON.stringify({ error: msg }) + `
`);
    } else {
      write(`
  ${c.red("✘ " + msg)}

`);
    }
    return 1;
  }
}
function printCheck(name, status, detail, durationMs) {
  const label = name.length >= 44 ? name.slice(0, 43) + "…" : name;
  const dots = ".".repeat(Math.max(3, 44 - label.length));
  let icon;
  let word;
  if (status === "pass") {
    icon = c.green("✔");
    word = c.green("PASS");
  } else if (status === "warn") {
    icon = c.yellow("!");
    word = c.yellow("WARN");
  } else {
    icon = c.red("✘");
    word = c.red("FAIL");
  }
  const time = durationMs != null ? c.dim(` ${durationMs}ms`) : "";
  let det = detail ?? "";
  if (det.length > 110)
    det = det.slice(0, 107) + "…";
  write(`  ${icon} ${label} ${c.dim(dots)} ${word}${time}${det ? c.dim("  " + det) : ""}
`);
}
main().then((code) => process.exit(code)).catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : String(e)}
`);
  process.exit(1);
});
