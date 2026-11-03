#!/usr/bin/env node
/**
 * probe-protocol.mjs — z.ai lab protocol probe battery.
 *
 * Systematically documents the ACTUAL behavior of the official OoklaServer
 * daemon on port 8080: HTTP surface, HEAD/Range semantics, upload semantics,
 * crossdomain policy, CORS, keep-alive, raw TCP netgauge, WebSocket upgrade
 * path sensitivity + accept-key correctness, netgauge-over-WS, TLS versions,
 * strict CA verification, and UDP netgauge.
 *
 * Zero dependencies (node >= 18). Usage:
 *   node probe-protocol.mjs [host] [port] > report.json
 */
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HOST = process.argv[2] || "localhost";
const PORT = parseInt(process.argv[3] || "8080", 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CA = readFileSync(path.join(__dirname, "..", "certs", "ca-bundle.pem"));

  const results = [];
  const record = (group, name, data) => {
  results.push({ group, name, ...data });
  const ok = data.expectation === data.result;
  console.error(`${ok ? "OK " : "?? "} [${group}] ${name}: result=${JSON.stringify(data.result)} ${data.detail ?? ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Raw HTTP request over a socket (keeps control over connection reuse) */
/* ------------------------------------------------------------------ */
function rawHttp(port, reqs, { tls: useTls = false, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tls.connect({ host: HOST, port, rejectUnauthorized: false, servername: HOST, timeout })
      : net.connect({ host: HOST, port, timeout });
    let buf = Buffer.alloc(0);
    const parts = [];
    const isHead = reqs.some((r) => r.method === "HEAD");
    socket.on("connect", () => {
      // NOTE: the official daemon 500s any HTTP request without a User-Agent
      // header (verified 2026-11-03) — always send one.
      const payload = reqs
        .map(
          (r) =>
            `${r.method} ${r.path} HTTP/1.1\r\nHost: ${HOST}:${port}\r\nUser-Agent: zai-lab-probe/1.0\r\n${
              r.headers ? Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n" : ""
            }${r.body ? `Content-Length: ${Buffer.byteLength(r.body)}\r\n` : ""}\r\n${r.body ?? ""}`,
        )
        .join("");
      socket.write(payload);
    });
    let quietTimer = null;
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      // keep-alive connections never close: resolve after a short quiet period
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        socket.destroy();
        resolve({ raw: buf.toString("latin1"), parts: splitResponses(buf, isHead) });
      }, 350);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ raw: buf.toString("latin1"), parts: splitResponses(buf, isHead) });
    });
    socket.on("error", reject);
    socket.on("close", () => resolve({ raw: buf.toString("latin1"), parts: splitResponses(buf, isHead) }));
  });
}

function splitResponses(buf, isHead = false) {
  const out = [];
  let rest = buf;
  while (true) {
    const idx = rest.indexOf("\r\n\r\n");
    if (idx === -1) break;
    const head = rest.subarray(0, idx).toString("latin1");
    const m = head.match(/Content-Length:\s*(\d+)/i);
    const statusLine = head.split("\r\n")[0] || "";
    if (isHead) {
      // HEAD responses have no body regardless of Content-Length
      out.push({ statusLine, headers: head, body: "" });
      rest = rest.subarray(idx + 4);
    } else if (m) {
      const len = parseInt(m[1], 10);
      const total = idx + 4 + len;
      if (rest.length < total) break; // incomplete
      out.push({ statusLine, headers: head, body: rest.subarray(idx + 4, total).toString("latin1") });
      rest = rest.subarray(total);
    } else {
      out.push({ statusLine, headers: head, body: "" });
      rest = rest.subarray(idx + 4);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. HTTP endpoint surface                                            */
/* ------------------------------------------------------------------ */
async function httpSurface() {
  const endpoints = [
    { path: "/", method: "GET" },
    { path: "/hi", method: "GET" },
    { path: "/speedtest/latency.txt", method: "GET" },
    { path: "/crossdomain.xml", method: "GET" },
    { path: "/speedtest/upload.php", method: "GET" },
    { path: "/speedtest/server.php", method: "GET" },
    { path: "/favicon.ico", method: "GET" },
    { path: "/definitely-not-here", method: "GET" },
  ];
  for (const e of endpoints) {
    const r = await rawHttp(PORT, [e]);
    const first = r.parts[0];
    const status = first ? first.statusLine : "(no response)";
    record("http", `${e.method} ${e.path}`, {
      expectation: "documented",
      result: "documented",
      detail: `${status} · body[:60]=${first ? JSON.stringify(first.body.slice(0, 60)) : "-"}`,
      status: first ? parseInt(first.statusLine.split(" ")[1], 10) : 0,
      body: first ? first.body.slice(0, 400) : "",
      headers: first ? first.headers : "",
    });
  }
}

/* ------------------------------------------------------------------ */
/* 2. HEAD + Range on random*.jpg                                      */
/* ------------------------------------------------------------------ */
async function imageSemantics() {
  const sizes = [350, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
  const table = [];
  for (const s of sizes) {
    const p = `/speedtest/random${s}x${s}.jpg`;
    const r = await rawHttp(PORT, [{ method: "HEAD", path: p }]);
    const first = r.parts[0];
    const cl = first?.headers.match(/Content-Length:\s*(\d+)/i)?.[1];
    const st = first ? parseInt(first.statusLine.split(" ")[1], 10) : 0;
    table.push({ file: p, headStatus: st, contentLength: cl ? parseInt(cl, 10) : null });
  }
  record("http", "HEAD random*.jpg (10 sizes)", {
    expectation: "200 + Content-Length",
    result: table.every((t) => t.headStatus === 200 && t.contentLength > 0) ? "200+CL" : "differs",
    detail: JSON.stringify(table),
    table,
  });

  // UA-required behavior (verified: daemon 500s UA-less HTTP requests)
  const noUa = await new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT, timeout: 4000 });
    let out = "";
    socket.on("connect", () => socket.write(`GET /hi HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\n\r\n`));
    socket.on("data", (d) => {
      out += d.toString("latin1");
      setTimeout(() => {
        socket.destroy();
        resolve(out.split("\r\n")[0]);
      }, 200);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve("timeout");
    });
    socket.on("error", () => resolve("error"));
  });
  record("http", "GET /hi WITHOUT User-Agent header", {
    expectation: "500 (daemon requires UA — verified behavior)",
    result: noUa,
    detail: noUa,
  });

  // Range request support?
  const rr = await rawHttp(PORT, [
    { method: "GET", path: "/speedtest/random350x350.jpg", headers: { Range: "bytes=0-1023" } },
  ]);
  const first = rr.parts[0];
  record("http", "GET random350 with Range: bytes=0-1023", {
    expectation: "unknown (probe)",
    result: first ? first.statusLine : "-",
    detail: `range-support=${first?.headers.match(/Content-Range:/i) ? "yes" : "no"} · CL=${
      first?.headers.match(/Content-Length:\s*(\d+)/i)?.[1] ?? "?"
    }`,
    headers: first?.headers ?? "",
  });
}

/* ------------------------------------------------------------------ */
/* 3. upload.php semantics                                             */
/* ------------------------------------------------------------------ */
async function uploadSemantics() {
  const body = `content1=${"A".repeat(1000)}`;
  const r = await rawHttp(PORT, [
    {
      method: "POST",
      path: "/speedtest/upload.php",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  ]);
  const first = r.parts[0];
  const st = first ? parseInt(first.statusLine.split(" ")[1], 10) : 0;
  const sent = Buffer.byteLength(body);
  const ret = first ? parseInt((first.body.match(/size=(\d+)/) || [])[1] ?? "0", 10) : 0;
  record("http", "POST /speedtest/upload.php (sent 1010 bytes)", {
    expectation: "200 · size=<sent bytes>",
    result: st === 200 && ret === sent ? "exact-match" : st === 200 ? `size=${ret} (sent ${sent})` : `HTTP ${st}`,
    detail: first ? first.body.trim().slice(0, 60) : "-",
    sent,
    returned: ret,
  });

  // callback param variant (mistral.ai reference: /upload.php?callback=test)
  const r2 = await rawHttp(PORT, [
    {
      method: "POST",
      path: "/speedtest/upload.php?callback=test",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  ]);
  const f2 = r2.parts[0];
  record("http", "POST /speedtest/upload.php?callback=test", {
    expectation: "probe",
    result: f2 ? f2.statusLine : "-",
    detail: f2 ? f2.body.trim().slice(0, 80) : "-",
  });
}

/* ------------------------------------------------------------------ */
/* 4. CORS probe                                                       */
/* ------------------------------------------------------------------ */
async function corsProbe() {
  const r = await rawHttp(PORT, [
    {
      method: "GET",
      path: "/speedtest/latency.txt",
      headers: { Origin: "https://www.speedtest.net" },
    },
  ]);
  const first = r.parts[0];
  const acao = first?.headers.match(/Access-Control-Allow-Origin:\s*(.*)/i)?.[1]?.trim();
  record("http", "CORS: Origin: https://www.speedtest.net", {
    expectation: "probe (does daemon send ACAO?)",
    result: acao ? `ACAO=${acao}` : "no ACAO header",
    headers: first?.headers ?? "",
  });

  // 3xx redirect behavior probe: does the daemon ever redirect?
  const r2 = await rawHttp(PORT, [
    { method: "GET", path: "/", headers: { Host: `some.other.host:${PORT}` } },
  ]);
  const f2 = r2.parts[0];
  record("http", "GET / with foreign Host header", {
    expectation: "probe (redirect or direct 200?)",
    result: f2 ? f2.statusLine : "-",
    detail: f2 ? (f2.headers.match(/Location:\s*(.*)/i)?.[1] ?? "no Location header") : "-",
  });
}

/* ------------------------------------------------------------------ */
/* 5. Keep-alive: two requests on ONE socket                           */
/* ------------------------------------------------------------------ */
async function keepAliveProbe() {
  const r = await rawHttp(PORT, [
    { method: "GET", path: "/speedtest/latency.txt" },
    { method: "GET", path: "/speedtest/latency.txt" },
  ]);
  const ok = r.parts.length === 2 && r.parts.every((p) => p.statusLine.includes("200"));
  record("http", "Keep-Alive: 2 requests on one socket", {
    expectation: "2x 200 on persistent connection",
    result: ok ? "persistent-ok" : `responses=${r.parts.length}`,
    detail: r.parts.map((p) => p.statusLine).join(" | "),
    responses: r.parts.map((p) => p.statusLine),
  });
}

/* ------------------------------------------------------------------ */
/* 6. Raw TCP netgauge (plaintext)                                     */
/* ------------------------------------------------------------------ */
function tcpNetgauge(cmd, { expectBytes = null, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT, timeout });
    let buf = Buffer.alloc(0);
    let settled = false;
    const done = (err, data) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ err, data, raw: buf });
    };
    socket.on("connect", () => socket.write(cmd));
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (expectBytes != null) {
        if (buf.length >= expectBytes) done(null, buf);
      } else if (buf.length > 0) {
        // wait a beat for full line
        setTimeout(() => done(null, buf), 150);
      }
    });
    socket.on("timeout", () => done("timeout", buf));
    socket.on("error", (e) => done(e.message, buf));
    socket.on("close", () => done(null, buf));
  });
}

async function rawNetgauge() {
  let r = await tcpNetgauge("HI\n");
  record("netgauge-tcp", 'raw TCP "HI\\n"', {
    expectation: "HELLO <version>",
    result: r.data?.toString("utf8").startsWith("HELLO") ? "HELLO" : r.err ? `err:${r.err}` : "no-hello",
    detail: r.data ? r.data.toString("utf8").trim().slice(0, 80) : "-",
  });

  r = await tcpNetgauge(`PING ${Date.now()}\n`);
  record("netgauge-tcp", 'raw TCP "PING <epoch-ms>"', {
    expectation: "PONG <epoch-ms>",
    result: r.data?.toString("utf8").startsWith("PONG") ? "PONG" : "unexpected",
    detail: r.data ? r.data.toString("utf8").trim().slice(0, 40) : "-",
  });

  r = await tcpNetgauge("DOWNLOAD 100000\n", { expectBytes: 100000, timeout: 6000 });
  const dl = r.data ?? Buffer.alloc(0);
  record("netgauge-tcp", 'raw TCP "DOWNLOAD 100000"', {
    expectation: "EXACTLY 100000 bytes; the 'DOWNLOAD ' 9-byte prefix is PART of the payload",
    result:
      dl.length === 100000 && dl.subarray(0, 9).toString("latin1") === "DOWNLOAD "
        ? "exact-100000-bytes-incl-prefix"
        : `len=${dl.length}`,
    detail: `prefix=${JSON.stringify(dl.subarray(0, 12).toString("latin1"))}`,
  });

  const upPayload = Buffer.alloc(2048, 0x42);
  r = await new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT, timeout: 5000 });
    let buf = Buffer.alloc(0);
    let sent = false;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ data: buf });
    };
    socket.on("connect", () => socket.write("UPLOAD 2048\n"));
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!sent) {
        sent = true;
        setTimeout(() => socket.write(upPayload), 100);
      }
      setTimeout(done, 400);
    });
    socket.on("timeout", done);
    socket.on("error", done);
    socket.on("close", done);
  });
  record("netgauge-tcp", 'raw TCP "UPLOAD 2048" + payload', {
    expectation: "OK <bytes> <epoch-ms>",
    result: r.data?.toString("utf8").startsWith("OK") ? "OK" : `resp=${r.data?.toString("utf8").trim().slice(0, 40)}`,
    detail: r.data ? r.data.toString("utf8").trim().slice(0, 60) : "-",
  });

  r = await tcpNetgauge("GARBAGE_COMMAND\n");
  record("netgauge-tcp", 'raw TCP "GARBAGE_COMMAND"', {
    expectation: "ERROR",
    result: r.data?.toString("utf8").trim() === "ERROR" ? "ERROR" : `resp=${r.data?.toString("utf8").trim().slice(0, 40)}`,
    detail: r.data ? r.data.toString("utf8").trim().slice(0, 40) : "-",
  });
}

/* ------------------------------------------------------------------ */
/* 7. WebSocket upgrade path sensitivity + accept-key                   */
/* ------------------------------------------------------------------ */
function wsProbe(pathname, { secure = false, badKey = false } = {}) {
  return new Promise((resolve) => {
    const key = badKey ? "AAAAAAAAAAAAAAAAAAAAAA==" : crypto.randomBytes(16).toString("base64");
    const mod = secure ? https : http;
    const req = mod.request({
      host: HOST,
      port: PORT,
      path: pathname,
      method: "GET",
      headers: {
        Host: `${HOST}:${PORT}`,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": 13,
        "User-Agent": "zai-lab-probe/1.0",
      },
      ...(secure ? { rejectUnauthorized: false, servername: HOST } : {}),
      timeout: 5000,
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ err: e.message }));
    req.on("response", (res) => {
      res.resume();
      resolve({ httpStatus: res.statusCode });
    });
    req.on("upgrade", (res, socket) => {
      const accept = res.headers["sec-websocket-accept"] ?? "";
      const expected = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      resolve({
        upgraded: true,
        accept,
        acceptValid: accept === expected,
        headers: res.headers,
        socket,
      });
    });
    req.end();
  });
}

function wsRoundtrip(socket, sendText, timeoutMs = 3000) {
  return new Promise((resolve) => {
    // masked client frame
    const payload = Buffer.from(sendText, "utf8");
    const mask = crypto.randomBytes(4);
    const masked = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
    const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ err: "timeout", raw: buf.toString("utf8").slice(0, 80) });
    }, timeoutMs);
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 2) {
        // strip the server frame header (fin+opcode, len; no mask from server)
        const len = buf[1] & 0x7f;
        if (buf.length >= 2 + len) {
          clearTimeout(timer);
          const text = buf.subarray(2, 2 + len).toString("utf8");
          socket.destroy();
          resolve({ text: text.slice(0, 120) });
        }
      }
    });
    socket.write(frame);
  });
}

async function websocketProbes() {
  for (const p of ["/ws", "/", "/anything-else"]) {
    const r = await wsProbe(p);
    record("ws", `WS upgrade on "${p}"`, {
      expectation: p === "/ws" ? "101 upgrade" : "probe (does path matter?)",
      result: r.err ? `err:${r.err}` : r.upgraded ? "101-upgrade" : `http-${r.httpStatus}`,
      detail: r.upgraded ? `acceptValid=${r.acceptValid}` : "",
    });
  }

  // netgauge over WS on /ws + accept key correctness
  const r = await wsProbe("/ws");
  if (r.upgraded && r.socket) {
    const hello = await wsRoundtrip(r.socket, "HI\n");
    record("ws", 'netgauge over WS: "HI\\n" on /ws', {
      expectation: "HELLO <version>",
      result: hello.text?.startsWith("HELLO") ? "HELLO" : `resp=${hello.err ?? hello.text}`,
      detail: hello.text?.trim().slice(0, 80) ?? "",
    });
  }

  // WSS on the same port
  const rs = await wsProbe("/ws", { secure: true });
  record("ws", "WSS upgrade on /ws (same port 8080)", {
    expectation: "101 upgrade over TLS",
    result: rs.err ? `err:${rs.err}` : rs.upgraded ? "101-upgrade" : `http-${rs.httpStatus}`,
    detail: rs.upgraded ? `acceptValid=${rs.acceptValid}` : "",
  });
}

/* ------------------------------------------------------------------ */
/* 8. TLS behavior                                                     */
/* ------------------------------------------------------------------ */
function tlsProbe(version) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: HOST,
      port: PORT,
      rejectUnauthorized: false,
      servername: HOST,
      ...(version ? { minVersion: version, maxVersion: version } : {}),
      timeout: 4000,
    });
    socket.on("secureConnect", () => {
      const proto = socket.getProtocol();
      socket.destroy();
      resolve({ ok: true, proto });
    });
    socket.on("error", (e) => resolve({ ok: false, err: e.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, err: "timeout" });
    });
  });
}

function tlsStrictVerify(ca, servername) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: HOST,
      port: PORT,
      ca,
      servername: servername ?? HOST,
      rejectUnauthorized: true,
      timeout: 4000,
    });
    socket.on("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();
      resolve({ ok: true, subject: cert?.subject?.CN, issuer: cert?.issuer?.CN });
    });
    socket.on("error", (e) => resolve({ ok: false, err: e.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, err: "timeout" });
    });
  });
}

async function tlsProbes() {
  // Node 24 cannot offer TLS < 1.2 client-side; probe 1.0/1.1 via openssl s_client.
  for (const v of ["TLSv1.0", "TLSv1.1"]) {
    const flag = v === "TLSv1.0" ? "-tls1" : "-tls1_1";
    const r = await new Promise((resolve) => {
      exec(
        `echo | timeout 6 openssl s_client -connect ${HOST}:${PORT} ${flag} -cipher 'DEFAULT@SECLEVEL=0' 2>&1`,
        { shell: "/bin/bash" },
        (err, stdout) => {
          const ok = /New, \(NONE\)/.test(stdout) || /alert protocol version/.test(stdout);
          resolve(ok ? "rejected (protocol_version alert)" : `accepted? ${stdout.match(/New, .*/)?.[0] ?? ""}`);
        },
      );
    });
    record("tls", `handshake forcing ${v}`, {
      expectation: "rejected (minimumTLSProtocol=1.2)",
      result: r,
    });
  }
  for (const v of ["TLSv1.2", "TLSv1.3"]) {
    const r = await tlsProbe(v);
    record("tls", `handshake forcing ${v}`, {
      expectation: "accepted",
      result: r.ok ? `accepted (${r.proto})` : `rejected (${r.err?.split(":")[0]})`,
    });
  }

  // Strict CA verification — our lab CA is in the bundle and cert is valid
  // (hostname localhost is in SAN). This MUST succeed:
  const r = await tlsStrictVerify(CA, "localhost");
  record("tls", "strict verify, CA bundle, SAN localhost", {
    expectation: "verify-ok",
    result: r.ok ? "verify-ok" : `verify-FAIL (${r.err})`,
    detail: r.ok ? `subject=${r.subject} issuer=${r.issuer}` : r.err,
  });

  // Strict verify against wrong name — MUST fail:
  const r2 = await tlsStrictVerify(CA, "wrong.ookla.test");
  record("tls", "strict verify, wrong hostname", {
    expectation: "verify-FAIL (hostname mismatch)",
    result: r2.ok ? "verify-ok (UNEXPECTED)" : "verify-FAIL",
    detail: r2.ok ? "" : r2.err,
  });

  // Strict verify with EMPTY CA bundle (untrusted) — MUST fail:
  const r3 = await tlsStrictVerify(Buffer.from(""), "localhost");
  record("tls", "strict verify, no trusted CA", {
    expectation: "verify-FAIL (self-signed/untrusted)",
    result: r3.ok ? "verify-ok (UNEXPECTED)" : "verify-FAIL",
    detail: r3.ok ? "" : r3.err,
  });
}

/* ------------------------------------------------------------------ */
/* 9. UDP netgauge probe                                               */
/* ------------------------------------------------------------------ */
function udpProbe(payload, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    let got = null;
    const timer = setTimeout(() => {
      try { sock.close(); } catch {}
      resolve({ err: "timeout", got });
    }, timeoutMs);
    sock.on("message", (msg, rinfo) => {
      got = { len: msg.length, head: msg.subarray(0, 16), rinfo };
      clearTimeout(timer);
      try { sock.close(); } catch {}
      resolve({ got });
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      try { sock.close(); } catch {}
      resolve({ err: e.message });
    });
    sock.send(payload, PORT, HOST, (e) => {
      if (e) {
        clearTimeout(timer);
        try { sock.close(); } catch {}
        resolve({ err: e.message });
      }
    });
  });
}

async function udpProbes() {
  // The UDP netgauge protocol is proprietary; try plausible probes and
  // document what happens.
  for (const [name, payload] of [
    ["HI\\n text", Buffer.from("HI\n", "utf8")],
    ["PING text", Buffer.from(`PING ${Date.now()}\n`, "utf8")],
    ["8 zero bytes", Buffer.alloc(8)],
    ["1 zero byte", Buffer.from([0])],
  ]) {
    const r = await udpProbe(payload);
    record("netgauge-udp", `UDP probe: ${name}`, {
      expectation: "probe (proprietary protocol — is any response returned?)",
      result: r.err ? "no-response" : `response len=${r.got?.len} head=${r.got?.head.toString("hex")}`,
      detail: r.err ?? "",
    });
  }
}
import dgram from "node:dgram";
import { exec } from "node:child_process";

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
(async () => {
  const ip = await dns.promises.lookup(HOST).catch(() => null);
  console.error(`# z.ai lab protocol probe — ${HOST}:${PORT} (${ip?.address}) — ${new Date().toISOString()}`);
  await httpSurface();
  await imageSemantics();
  await uploadSemantics();
  await corsProbe();
  await keepAliveProbe();
  await rawNetgauge();
  await websocketProbes();
  await tlsProbes();
  await udpProbes();
  console.log(JSON.stringify({ host: HOST, port: PORT, ip: ip?.address, when: new Date().toISOString(), results }, null, 2));
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
