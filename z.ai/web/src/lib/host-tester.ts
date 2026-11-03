/**
 * Speedtest Host Tester engine — a faithful re-implementation of what the
 * Ookla® Server Tester (speedtest.net/host-tester) does behind the scenes.
 *
 * Checks performed (per Ookla's official documentation):
 *   1. OoklaServer daemon accepting connections   (GET http://host:port/)
 *   2. OoklaServer daemon version                  (netgauge WS: "HI" -> "HELLO <ver>")
 *   3. Netgauge / WebSocket functionality on 8080  (ws(s)://host:port/ws, PING -> PONG)
 *   4. HTTPS functionality                         (TLS handshake + response)
 *   5. Keep-Alive                                  (Connection response header)
 *   6. Latency file                                (GET /speedtest/latency.txt)
 *   7. Download image files                        (GET /speedtest/random{N}x{N}.jpg)
 *   8. Legacy HTTP upload script                   (POST /speedtest/upload.php -> "size=N")
 *   9. Crossdomain settings                        (GET /crossdomain.xml)
 *
 * Speed measurements follow Ookla's documented HTTP legacy methodology:
 *   - Latency: repeated small requests, the LOWEST value is the final result.
 *   - Download: pre-test estimates speed -> selects file size; 4 threads when
 *     the estimate is >= 4 Mbit/s (otherwise 2); cache prevention via random
 *     strings; samples aggregated per Ookla's sorting rules.
 *   - Upload: small pre-test upload -> uniform chunk size; up to 4 parallel
 *     threads; chunks sorted by speed, the fastest half is averaged.
 *
 * Zero runtime dependencies (node: builtins + global fetch). Node >= 18.
 */

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";
import dns from "node:dns";
import {
  SPEEDTEST_IMAGE_SIZES,
  speedtestImagePath,
  formatBytes,
  type CheckResult,
  type CheckStatus,
  type HostTestEvent,
  type HostTestSummary,
  type PingStats,
  type RunHandlers,
  type RunOptions,
  type SpeedResult,
} from "./host-tester-types";

const now = () => performance.now();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const randHex = (n = 8) => crypto.randomBytes(n).toString("hex");
const isAbortError = (e: unknown) =>
  !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";
const isIpAddress = (host: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");

/** Unwraps cause chains (e.g. undici's "fetch failed" -> ECONNREFUSED 1.2.3.4:8080). */
const errText = (e: unknown): string => {
  const messages: string[] = [];
  let cur: unknown = e;
  let guard = 0;
  while (cur != null && guard++ < 6) {
    const c = cur as {
      message?: string;
      code?: string;
      address?: string;
      port?: number;
      cause?: unknown;
      errors?: Array<{ code?: string; message?: string; address?: string; port?: number }>;
    };
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
    if (m) messages.push(m);
    cur = c.cause;
  }
  const filtered = messages.filter(
    (m) => m && m !== "fetch failed" && m !== "This operation was aborted",
  );
  const out = (filtered.length > 0 ? filtered : messages).join(" · ");
  return out || "unknown error";
};

const RANDOM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Real browsers (and Ookla's own tester) always send a User-Agent — some
 * production OoklaServers reset connections that don't (verified live).
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Random alphanumeric string of length n (the legacy upload payload). */
function randomChars(n: number): string {
  const bytes = crypto.randomBytes(n);
  const parts: string[] = [];
  const CHUNK = 8192;
  for (let i = 0; i < n; i += CHUNK) {
    let s = "";
    const end = Math.min(n, i + CHUNK);
    for (let j = i; j < end; j++) s += RANDOM_ALPHABET[bytes[j] % RANDOM_ALPHABET.length];
    parts.push(s);
  }
  return parts.join("");
}

/** Combines abort signals + a timeout into one signal. */
class SignalGroup {
  private ac = new AbortController();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private signals: AbortSignal[] = [];
  private onAbort = () => this.ac.abort();

  constructor(signals: (AbortSignal | undefined)[], timeoutMs?: number) {
    for (const s of signals) {
      if (!s) continue;
      this.signals.push(s);
      if (s.aborted) this.ac.abort();
      else s.addEventListener("abort", this.onAbort, { once: true });
    }
    if (timeoutMs && timeoutMs > 0) {
      this.timers.push(setTimeout(() => this.ac.abort(), timeoutMs));
    }
  }

  get signal(): AbortSignal { return this.ac.signal; }
  get aborted(): boolean { return this.ac.signal.aborted; }
  cleanup(): void {
    for (const t of this.timers) clearTimeout(t);
    for (const s of this.signals) s.removeEventListener("abort", this.onAbort);
  }
}

/**
 * Parse user input into { host, port }.
 * Lenient on purpose: strips http(s)://, strips paths, defaults the port to
 * 8080 (the OoklaServer requirement) when only a domain is given.
 */
export function parseTarget(raw: string): { host: string; port: number } | null {
  let s = (raw || "").trim();
  if (!s) return null;
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ""); // strip scheme
  s = s.replace(/\/.*$/, ""); // strip path
  s = s.replace(/\.+$/, "");

  let host = "";
  let port = 8080;

  if (s.startsWith("[")) {
    // [IPv6] or [IPv6]:port
    const m = s.match(/^\[([0-9a-fA-F:.%]+)\](?::(\d+))?$/);
    if (!m) return null;
    host = m[1];
    if (m[2]) port = parseInt(m[2], 10);
  } else if (
    // unbracketed string with "::" or ≥2 colons can only be a bare IPv6
    // literal (never a valid host:port) — e.g. "::1", "2001:db8::1"
    /^[0-9a-fA-F:.]+$/.test(s) && (s.includes("::") || (s.match(/:/g) ?? []).length >= 2)
  ) {
    host = s;
  } else {
    const m = s.match(/^(.+):(\d+)$/);
    if (m) {
      host = m[1];
      port = parseInt(m[2], 10);
    } else {
      host = s;
    }
  }

  if (!host || port < 1 || port > 65535) return null;

  const isIPv4 = net.isIP(host) === 4;
  // An unbracketed string containing ":" is only acceptable as a bare IPv6
  // literal WITHOUT a port (e.g. "::1", "2001:db8::1"). "host.example.com:notaport"
  // must be rejected — v1.0.1 wrongly accepted it as an IPv6 host.
  // (regression test: tests/regression.mjs)
  const isIPv6 = net.isIP(host) === 6;
  const isHostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(host);
  if (!isIPv4 && !isIPv6 && !isHostname) return null;
  if (isIPv4 && host.split(".").some((p) => parseInt(p, 10) > 255)) return null;
  // dotted-quad-shaped but invalid (e.g. "256.1.1.1") is a typo, not a hostname
  if (!isIPv4 && /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  return { host, port };
}

/* ------------------------------------------------------------------ */
/* Minimal RFC6455 WebSocket client (no dependencies).                 */
/* Only what the Ookla netgauge handshake needs: text frames + close.  */
/* ------------------------------------------------------------------ */

interface WsConn {
  sendText(s: string): void;
  nextText(timeoutMs: number): Promise<string>;
  close(): void;
}

function wsClientFrame(opcode: number, payload: Buffer): Buffer {
  const mask = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
  let head: Buffer;
  if (payload.length < 126) {
    head = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 0x80 | 126;
    head.writeUInt16BE(payload.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([head, mask, masked]);
}

function wsConnect(opts: {
  host: string;
  port: number;
  secure: boolean;
  path?: string;
  timeoutMs?: number;
}): Promise<WsConn> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const mod = opts.secure ? https : http;
    const options: https.RequestOptions = {
      host: opts.host,
      port: opts.port,
      path: opts.path ?? "/ws",
      method: "GET",
      timeout: opts.timeoutMs ?? 8000,
      headers: {
        // bracket IPv6 literals in the Host header (RFC 3986 authority form)
        Host: `${opts.host.includes(":") && !opts.host.startsWith("[") ? `[${opts.host}]` : opts.host}:${opts.port}`,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
        "User-Agent": BROWSER_UA,
      },
      ...(opts.secure
        ? { rejectUnauthorized: false, ...(isIpAddress(opts.host) ? {} : { servername: opts.host }) }
        : {}),
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
      let buf: Buffer = Buffer.from(head ?? []);
      const queue: string[] = [];
      let waiter: {
        resolve: (s: string) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      } | null = null;
      const fragParts: Buffer[] = [];
      let fragOpcode = 0;
      let closed = false;

      const failWaiter = (e: Error) => {
        if (waiter) {
          clearTimeout(waiter.timer);
          const w = waiter;
          waiter = null;
          w.reject(e);
        }
      };

      const deliver = (text: string) => {
        if (waiter) {
          clearTimeout(waiter.timer);
          const w = waiter;
          waiter = null;
          w.resolve(text);
        } else {
          queue.push(text);
        }
      };

      const handleFrame = (fin: boolean, opcode: number, payload: Buffer) => {
        if (opcode === 0x1 || opcode === 0x2) {
          if (fin && fragParts.length === 0) {
            deliver(payload.toString("utf8"));
          } else {
            fragOpcode = opcode;
            fragParts.push(payload);
            if (fin) {
              const full = Buffer.concat(fragParts);
              fragParts.length = 0;
              if (fragOpcode === 0x1) deliver(full.toString("utf8"));
            }
          }
        } else if (opcode === 0x0) {
          fragParts.push(payload);
          if (fin) {
            const full = Buffer.concat(fragParts);
            fragParts.length = 0;
            if (fragOpcode === 0x1) deliver(full.toString("utf8"));
          }
        } else if (opcode === 0x8) {
          // close frame
          try { socket.write(wsClientFrame(0x8, Buffer.alloc(0))); } catch { /* noop */ }
          socket.destroy();
          failWaiter(new Error("websocket closed by server"));
        } else if (opcode === 0x9) {
          try { socket.write(wsClientFrame(0xa, payload)); } catch { /* noop */ }
        }
      };

      const tryParse = () => {
        for (;;) {
          if (buf.length < 2) return;
          const b0 = buf[0];
          const b1 = buf[1];
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
            const big = buf.readBigUInt64BE(2);
            if (big > BigInt(64 * 1024 * 1024)) {
              socket.destroy();
              failWaiter(new Error("websocket frame too large"));
              return;
            }
            len = Number(big);
            off = 10;
          }
          let maskKey: Buffer | null = null;
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
          handleFrame(fin, opcode, payload);
        }
      };

      socket.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        tryParse();
      });
      socket.on("error", (e: Error) => failWaiter(e));
      socket.on("close", () => failWaiter(new Error("websocket connection closed")));

      resolve({
        sendText(s: string) {
          socket.write(wsClientFrame(0x1, Buffer.from(s, "utf8")));
        },
        nextText(timeoutMs: number): Promise<string> {
          if (queue.length > 0) return Promise.resolve(queue.shift() as string);
          if (closed) return Promise.reject(new Error("websocket closed"));
          return new Promise<string>((res2, rej2) => {
            const timer = setTimeout(() => {
              waiter = null;
              rej2(new Error("websocket response timeout"));
            }, timeoutMs);
            waiter = { resolve: res2, reject: rej2, timer };
          });
        },
        close() {
          if (closed) return;
          closed = true;
          try { socket.write(wsClientFrame(0x8, Buffer.from([0x03, 0xe8]))); } catch { /* noop */ }
          socket.destroy();
        },
      });
    });
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Netgauge probe: HI -> HELLO <version>, PING -> PONG                 */
/* ------------------------------------------------------------------ */

interface NetgaugeResult {
  ok: boolean;
  secure?: boolean;
  version?: string;
  rtts?: number[];
  error?: string;
}

async function netgaugeProbe(
  host: string,
  port: number,
  pings: number,
  signal: AbortSignal | undefined,
): Promise<NetgaugeResult> {
  let lastErr = "unknown error";
  for (const secure of [true, false]) {
    let conn: WsConn | null = null;
    try {
      const g = new SignalGroup([signal], 10000);
      try {
        conn = await wsConnect({ host, port, secure, path: "/ws", timeoutMs: 8000 });
        conn.sendText("HI\n");
        const hello = await conn.nextText(4000);
        if (!/^HELLO\b/.test(hello)) throw new Error(`unexpected handshake: ${hello.slice(0, 60)}`);
        const version = hello.replace(/^HELLO\s*/, "").trim();
        const rtts: number[] = [];
        for (let i = 0; i < pings; i++) {
          const t0 = now();
          conn.sendText("PING 0 100\n");
          const pong = await conn.nextText(3000);
          if (!/^PONG\b/.test(pong)) throw new Error(`unexpected ping reply: ${pong.slice(0, 60)}`);
          rtts.push(now() - t0);
        }
        return { ok: true, secure, version, rtts };
      } finally {
        try { conn?.close(); } catch { /* noop */ }
        g.cleanup();
      }
    } catch (e) {
      lastErr = errText(e);
    }
  }
  return { ok: false, error: lastErr };
}

/* ------------------------------------------------------------------ */
/* HTTPS functionality check                                           */
/* ------------------------------------------------------------------ */

/** Strict validation probe (system/public CA store) — informational. */
function tlsTrustProbe(host: string, port: number, timeoutMs: number): Promise<{ trusted: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port,
      rejectUnauthorized: true,
      ...(isIpAddress(host) ? {} : { servername: host }),
      timeout: timeoutMs,
    });
    socket.on("secureConnect", () => {
      socket.destroy();
      resolve({ trusted: true });
    });
    socket.on("error", (e: Error & { code?: string }) => {
      resolve({ trusted: false, reason: (e as { code?: string }).code ?? e.message });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ trusted: false, reason: "timeout" });
    });
  });
}

function httpsCheck(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ ok: boolean; status: "pass" | "warn" | "fail"; detail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean, status: "pass" | "warn" | "fail", detail: string) => {
      if (!settled) { settled = true; resolve({ ok, status, detail }); }
    };
    let tlsInfo = "";
    let certWarn = "";
    const req = https.request(
      {
        host,
        port,
        path: "/",
        method: "GET",
        rejectUnauthorized: false,
        ...(isIpAddress(host) ? {} : { servername: host }),
        timeout: timeoutMs,
        headers: { "User-Agent": BROWSER_UA },
      },
      async (res) => {
        res.resume();
        const statusOk = (res.statusCode ?? 0) > 0;
        // After the functional result, enrich with a strict-trust probe.
        const trust = await tlsTrustProbe(host, port, timeoutMs).catch(() => ({ trusted: false, reason: "probe-error" }));
        const trustNote = trust.trusted
          ? "trust: publicly trusted ✓"
          : `trust: not publicly trusted (${trust.reason ?? "unknown"})`;
        const loc = res.headers.location ? ` · → ${res.headers.location}` : "";
        const detail = `HTTPS ${res.statusCode ?? "???"}${loc}${tlsInfo ? ` · ${tlsInfo}` : ""} · ${trustNote}${certWarn ? ` · ⚠ ${certWarn}` : ""}`;
        done(statusOk, certWarn ? "warn" : "pass", detail);
      },
    );
    req.on("socket", (sock) => {
      sock.on("secureConnect", () => {
        try {
          const cert = sock.getPeerCertificate();
          const proto = typeof sock.getProtocol === "function" ? sock.getProtocol() : "";
          const cn =
            (cert && cert.subject && (cert.subject.CN || cert.subject.O)) || "self-signed/unknown";
          const issuer = cert && cert.issuer && (cert.issuer.CN || cert.issuer.O) ? ` · issuer=${cert.issuer.CN || cert.issuer.O}` : "";
          let exp = "";
          if (cert && cert.valid_to) {
            const days = Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
            exp = `, valid ${days}d`;
            if (days < 0) certWarn = `certificate EXPIRED ${-days}d ago`;
          }
          // hostname match against the SAN list (when the target is a hostname)
          if (cert && typeof cert.subjectaltname === "string" && cert.subjectaltname && !isIpAddress(host)) {
            const sans: string[] = String(cert.subjectaltname).split(", ").map((s: string) => s.trim());
            const hostMatch = sans.some((s) => s === `DNS:${host}` || s === `DNS:*.${host.split(".").slice(1).join(".")}`);
            if (!hostMatch) certWarn = certWarn || `hostname "${host}" is not in the certificate SANs (${sans.slice(0, 4).join(", ")}…)`;
          }
          tlsInfo = `${proto}, CN=${cn}${issuer}${exp}`;
        } catch { /* noop */ }
      });
    });
    req.on("timeout", () => req.destroy(new Error("HTTPS connection timeout")));
    req.on("error", (e) => done(false, "fail", e.message));
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Small HTTP helpers (global fetch, keep-alive by default)            */
/* ------------------------------------------------------------------ */

async function fetchCheck(
  url: string,
  init: RequestInit,
  group: SignalGroup,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: group.signal,
    cache: "no-store",
    redirect: "manual", // never follow redirects — see explainRedirect()
    headers: { ...BROWSER_HEADERS, ...(init.headers as Record<string, string> | undefined) },
  });
}

/**
 * The official OoklaServer (verified 2026-11-03, build 2026-06-04.1737.7d0993d)
 * answers every plain-HTTP GET whose Host header does NOT match a certificate
 * SAN with `307 Temporary Redirect -> https://<cert-canonical-name>:<port>/`.
 * Blindly following that redirect produces misleading DNS errors for the cert
 * name (ENOTFOUND); instead we detect it and explain it.
 */
function explainRedirect(res: Response): string | null {
  if (res.status < 300 || res.status > 399) return null;
  const loc = res.headers.get("location");
  if (!loc) return `HTTP ${res.status} redirect without Location header`;
  return `server redirected to ${loc} — the daemon serves its legacy HTTP endpoints only for hostnames matching the certificate SANs; test with the certificate hostname (or fix the certificate) [verified official OoklaServer 2.11 behavior]`;
}

/* ------------------------------------------------------------------ */
/* Main engine                                                         */
/* ------------------------------------------------------------------ */

export async function runHostTest(
  input: string,
  handlers: RunHandlers = {},
  options: RunOptions = {},
): Promise<HostTestSummary> {
  const { onEvent = () => {}, signal } = handlers;
  const opts = {
    downloadSeconds: 10,
    uploadSeconds: 10,
    latencySamples: 10,
    netgaugePings: 5,
    timeoutMs: 150000,
    ...options,
  };

  const emit = (e: HostTestEvent) => {
    try { onEvent(e); } catch { /* listener errors must not break the test */ }
  };

  const parsed = parseTarget(input);
  if (!parsed) {
    const msg =
      "Invalid hostname format. Use hostname:port (e.g. speedtest.example.com:8080).";
    emit({ type: "error", message: msg });
    throw new Error(msg);
  }
  const { host, port } = parsed;
  const target = `${host}:${port}`;
  // IPv6 literals must be bracketed inside URLs (http://[::1]:8080/) — the
  // bare form only works in node request options / display strings.
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const base = `http://${urlHost}:${port}`;
  const startedAt = Date.now();

  // Global watchdog
  const watchdog = new SignalGroup([signal], opts.timeoutMs);
  const globalSignal = watchdog.signal;

  emit({ type: "start", target, host, port });

  const checks: CheckResult[] = [];

  const runCheck = async (
    id: string,
    name: string,
    fn: () => Promise<Omit<CheckResult, "id" | "name" | "durationMs">>,
  ): Promise<CheckResult> => {
    emit({ type: "check", check: { id, name, status: "running" } });
    const t0 = now();
    let result: Omit<CheckResult, "id" | "name" | "durationMs">;
    try {
      result = await fn();
    } catch (e) {
      result = { status: "fail", detail: errText(e) };
    }
    const full: CheckResult = { id, name, durationMs: Math.round(now() - t0), ...result };
    checks.push(full);
    emit({ type: "check", check: full });
    return full;
  };

  /* ---------- 1. hostname resolution ---------- */
  let ip: string | undefined;
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

  /* ---------- 2. OoklaServer daemon connection ---------- */
  let rootHeaders: Headers | null = null;
  let rootOk = false;
  let rootRedirect: string | null = null;
  await runCheck("daemon", "OoklaServer daemon connection", async () => {
    const g = new SignalGroup([globalSignal], 10000);
    try {
      const res = await fetchCheck(`${base}/`, { method: "GET" }, g);
      rootHeaders = res.headers;
      rootOk = res.ok || res.status < 500;
      rootRedirect = explainRedirect(res);
      if (rootRedirect) {
        // 3xx to the certificate's canonical HTTPS name is the official
        // daemon's verified response when Host is not in the cert SANs — the
        // daemon IS an OoklaServer and IS responding.
        return {
          status: "pass",
          detail: `OoklaServer daemon responding · ${rootRedirect}`,
        };
      }
      const body = (await res.text()).slice(0, 512);
      const server = res.headers.get("server") || "";
      const isOokla = /ooklaserver/i.test(body) || /ooklaserver/i.test(server);
      if (isOokla) {
        return { status: "pass", detail: `OoklaServer daemon detected (HTTP ${res.status})` };
      }
      return {
        status: rootOk ? "warn" : "fail",
        detail: rootOk
          ? `HTTP ${res.status} — daemon banner not identified`
          : `HTTP ${res.status}`,
      };
    } finally {
      g.cleanup();
    }
  });

  /* ---------- 3./4. Netgauge websocket + daemon version ---------- */
  emit({ type: "phase", phase: "netgauge", status: "start" });
  const ng = await netgaugeProbe(host, port, opts.netgaugePings, globalSignal);
  emit({ type: "phase", phase: "netgauge", status: "end" });

  // HTTP fallback for the version: `GET /hi` -> "hello <version>" is a
  // verified endpoint of the official OoklaServer (2026-11-03 lab). Used only
  // when the netgauge WebSocket handshake failed, so a WS-blocked but
  // HTTP-working daemon still reports its version.
  let hiVersion: string | undefined;
  let hiError: string | undefined;
  {
    const g = new SignalGroup([globalSignal], 6000);
    try {
      const res = await fetchCheck(`${base}/hi`, { method: "GET" }, g);
      const body = (await res.text()).slice(0, 128);
      const m = body.match(/^hello\s+(.+)$/im);
      if (res.ok && m) hiVersion = m[1].trim();
    } catch (e) {
      hiError = errText(e);
    } finally {
      g.cleanup();
    }
  }

  await runCheck("daemon-version", "OoklaServer daemon version", async () => {
    if (ng.ok && ng.version) {
      return { status: "pass", detail: ng.version };
    }
    if (hiVersion) {
      return {
        status: "pass",
        detail: `${hiVersion} · via GET /hi (netgauge handshake failed: ${ng.error ?? "unknown"})`,
      };
    }
    return { status: "fail", detail: `version unavailable — netgauge handshake failed (${ng.error ?? "unknown"})${hiError ? ` · GET /hi failed (${hiError})` : ""}` };
  });

  await runCheck("netgauge", "Netgauge / WebSocket (port " + port + ")", async () => {
    if (ng.ok) {
      const rtt = ng.rtts && ng.rtts.length ? Math.min(...ng.rtts).toFixed(1) : "—";
      const scheme = ng.secure ? "wss" : "ws";
      return {
        status: "pass",
        detail: `${scheme}://${target}/ws · HI→HELLO, PING→PONG ok, ws ping ${rtt} ms`,
      };
    }
    return { status: "fail", detail: ng.error ?? "netgauge websocket unreachable" };
  });

  /* ---------- 5. HTTPS functionality ---------- */
  await runCheck("https", "HTTPS functionality", async () => {
    const r = await httpsCheck(host, port, 8000);
    return { status: r.status, detail: r.detail };
  });

  /* ---------- 6. Keep-Alive ---------- */
  await runCheck("keepalive", "Keep-Alive", async () => {
    const conn = rootHeaders?.get("connection") ?? "";
    if (!rootHeaders) return { status: "fail", detail: "no HTTP response to inspect" };
    const ok = /keep-alive/i.test(conn);
    return {
      status: ok ? "pass" : "fail",
      detail: ok ? `Connection: ${conn}` : `Connection: ${conn || "(none)"}`,
    };
  });

  /* ---------- 7. Latency file ---------- */
  let latencyFileOk = false;
  await runCheck("latency-file", "Latency file (speedtest/latency.txt)", async () => {
    const g = new SignalGroup([globalSignal], 8000);
    try {
      const res = await fetchCheck(`${base}/speedtest/latency.txt`, { method: "GET" }, g);
      const redir = explainRedirect(res);
      if (redir) return { status: "fail", detail: redir };
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

  /* ---------- 8. Download image files ---------- */
  const imageSizes: { size: number; bytes: number | null }[] = [];
  await runCheck("images", "Download image files (random*.jpg)", async () => {
    const g = new SignalGroup([globalSignal], 8000);
    try {
      let redirectDetail: string | null = null;
      for (const s of SPEEDTEST_IMAGE_SIZES) {
        let bytes: number | null = null;
        let status = 0;
        try {
          const res = await fetchCheck(`${base}${speedtestImagePath(s)}`, { method: "HEAD" }, g);
          status = res.status;
          if (!redirectDetail) redirectDetail = explainRedirect(res);
          const cl = res.headers.get("content-length");
          bytes = cl ? parseInt(cl, 10) : null;
          if (res.status === 405 || (res.ok && bytes == null)) {
            // HEAD unsupported — fall back to a ranged GET for the length
            const res2 = await fetchCheck(`${base}${speedtestImagePath(s)}`, { method: "GET" }, g);
            const buf = await res2.arrayBuffer();
            bytes = buf.byteLength;
            status = res2.status;
          }
        } catch (e) {
          if (isAbortError(e)) throw e;
        }
        imageSizes.push({ size: s, bytes: res_ok(status) ? bytes : null });
      }
      if (redirectDetail && imageSizes.every((i) => i.bytes == null)) {
        return { status: "fail", detail: redirectDetail };
      }
    } finally {
      g.cleanup();
    }
    const found = imageSizes.filter((i) => i.bytes != null);
    if (found.length === 0) {
      return { status: "fail", detail: "no download images found" };
    }
    const missing = imageSizes.filter((i) => i.bytes == null).map((i) => `${i.size}x${i.size}`);
    const range = `${formatBytes(found[0].bytes as number)} – ${formatBytes(found[found.length - 1].bytes as number)}`;
    if (found.length < imageSizes.length) {
      return { status: "fail", detail: `${found.length}/${imageSizes.length} files · missing: ${missing.join(", ")}` };
    }
    return { status: "pass", detail: `${found.length}/${imageSizes.length} files (${range})` };
  });

  /* ---------- 9. Legacy HTTP upload script ---------- */
  let uploadScriptOk = false;
  await runCheck("upload-script", "Legacy HTTP upload script (upload.php)", async () => {
    const g = new SignalGroup([globalSignal], 8000);
    try {
      const probe = `content1=${randomChars(256)}`;
      const res = await fetchCheck(`${base}/speedtest/upload.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": String(Buffer.byteLength(probe)),
        },
        body: probe,
      }, g);
      const redir = explainRedirect(res);
      if (redir) return { status: "fail", detail: redir };
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

  /* ---------- 10. Crossdomain settings ---------- */
  await runCheck("crossdomain", "Crossdomain settings (crossdomain.xml)", async () => {
    const g = new SignalGroup([globalSignal], 8000);
    try {
      const res = await fetchCheck(`${base}/crossdomain.xml`, { method: "GET" }, g);
      const redir = explainRedirect(res);
      if (redir) return { status: "fail", detail: redir };
      const body = (await res.text()).slice(0, 2048);
      if (res.ok && /cross-domain-policy/i.test(body)) {
        // Ookla's Server Tester expects allow-access-from domain="*"; a
        // policy that only lists specific domains triggers a warning
        // (documented Ookla support behavior — see docs/protocol notes).
        const domains = [...body.matchAll(/<allow-access-from[^>]*domain=\"([^\"]+)\"[^>]*>/gi)]
          .map((m) => m[1]);
        if (domains.includes("*")) {
          return { status: "pass", detail: `HTTP 200 · allow-access-from domain="*"` };
        }
        if (domains.length > 0) {
          return {
            status: "warn",
            detail: `HTTP 200 · policy allows only: ${domains.join(", ")} — Ookla expects domain="*"`,
          };
        }
        return { status: "warn", detail: `HTTP 200 · policy found but no allow-access-from rule parsed` };
      }
      return { status: "fail", detail: `HTTP ${res.status}` };
    } finally {
      g.cleanup();
    }
  });

  /* ================= speed measurements ================= */

  let netgaugePing: PingStats | undefined;
  let httpPing: PingStats | undefined;

  /* ---------- latency (HTTP legacy: repeated, lowest wins) ---------- */
  if (latencyFileOk && !globalSignal.aborted) {
    emit({ type: "phase", phase: "latency", status: "start" });
    const samples: number[] = [];
    for (let i = 0; i < opts.latencySamples; i++) {
      if (globalSignal.aborted) break;
      const g = new SignalGroup([globalSignal], 5000);
      try {
        const t0 = now();
        const res = await fetchCheck(
          `${base}/speedtest/latency.txt?ck=${randHex(8)}`,
          { method: "GET", headers: { "Cache-Control": "no-cache" } },
          g,
        );
        await res.text();
        const dt = now() - t0;
        samples.push(dt);
        emit({ type: "ping-sample", ms: Math.round(dt), index: i + 1, total: opts.latencySamples });
      } catch (e) {
        if (isAbortError(e)) break;
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

  /* ---------- download (Ookla HTTP legacy methodology) ---------- */
  let download: SpeedResult | undefined;
  const imagesAvailable = imageSizes.some((i) => i.bytes != null);
  if (imagesAvailable && !globalSignal.aborted) {
    emit({ type: "phase", phase: "download", status: "start" });
    try {
      download = await downloadPhase(base, opts.downloadSeconds, globalSignal, emit);
    } catch (e) {
      if (!isAbortError(e)) emit({ type: "log", message: `Download test failed: ${errText(e)}` });
    }
    emit({ type: "phase", phase: "download", status: "end" });
  } else if (!imagesAvailable) {
    emit({ type: "log", message: "Download test skipped: no download images available" });
  }

  /* ---------- upload (Ookla HTTP legacy methodology) ---------- */
  let upload: SpeedResult | undefined;
  if (uploadScriptOk && !globalSignal.aborted) {
    emit({ type: "phase", phase: "upload", status: "start" });
    try {
      upload = await uploadPhase(base, opts.uploadSeconds, globalSignal, emit);
    } catch (e) {
      if (!isAbortError(e)) emit({ type: "log", message: `Upload test failed: ${errText(e)}` });
    }
    emit({ type: "phase", phase: "upload", status: "end" });
  } else if (!uploadScriptOk) {
    emit({ type: "log", message: "Upload test skipped: upload.php not usable" });
  }

  /* ---------- verdict ---------- */
  const failed = checks.filter((c) => c.status === "fail");
  const passedCount = checks.filter((c) => c.status === "pass").length;
  const summary: HostTestSummary = {
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
      message:
        failed.length === 0
          ? "Server is publicly available and properly configured."
          : "Server configuration issues detected.",
      failed: failed.map((c) => c.name),
      passedCount,
      failedCount: failed.length,
    },
    startedAt,
    finishedAt: Date.now(),
    durationMs: Date.now() - startedAt,
  };

  watchdog.cleanup();
  emit({ type: "done", summary });
  return summary;
}

function res_ok(status: number): boolean {
  return status >= 200 && status < 300;
}

function stats(samples: number[], method: string): PingStats | undefined {
  if (!samples.length) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  let jitterSum = 0;
  for (let i = 1; i < samples.length; i++) jitterSum += Math.abs(samples[i] - samples[i - 1]);
  const jitter = samples.length > 1 ? jitterSum / (samples.length - 1) : 0;
  return {
    min: Math.round(min * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    max: Math.round(max * 10) / 10,
    jitter: Math.round(jitter * 10) / 10,
    samples: samples.length,
    method,
  };
}

/* ------------------------------------------------------------------ */
/* Download phase — pre-test, adaptive file size, 2/4 threads,         */
/* cache-busting, Ookla sample aggregation.                            */
/* ------------------------------------------------------------------ */

async function timedDownload(
  url: string,
  onBytes: (n: number) => void,
  group: SignalGroup,
): Promise<number> {
  const res = await fetch(url, {
    signal: group.signal,
    cache: "no-store",
    headers: { ...BROWSER_HEADERS, "Cache-Control": "no-cache" },
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      bytes += value.byteLength;
      onBytes(value.byteLength);
    }
    if (group.aborted) {
      try { await reader.cancel(); } catch { /* noop */ }
      throw new Error("aborted");
    }
  }
  return bytes;
}

async function downloadPhase(
  base: string,
  seconds: number,
  parentSignal: AbortSignal,
  emit: (e: HostTestEvent) => void,
): Promise<SpeedResult | undefined> {
  /* pre-test: estimate the speed with a mid-size file */
  let estimate = 0;
  {
    const g = new SignalGroup([parentSignal], 15000);
    try {
      const t0 = now();
      const bytes = await timedDownload(`${base}${speedtestImagePath(500)}?ck=${randHex(8)}`, () => {}, g);
      estimate = (bytes * 8) / 1e6 / ((now() - t0) / 1000);
    } catch {
      estimate = 0;
    } finally {
      g.cleanup();
    }
  }

  // Ookla rule: >= 4 threads when the pre-test indicates >= 4 Mbit/s
  const threads = estimate >= 4 ? 4 : 2;
  const file =
    estimate < 10 ? 1500 : estimate < 50 ? 2000 : estimate < 150 ? 3000 : 4000;

  // The download phase runs for exactly `seconds`: in-flight requests are
  // aborted at the deadline (Ookla: "The test ends once the configured
  // amount of time has been reached"). Partially transferred bytes count.
  const g = new SignalGroup([parentSignal], seconds * 1000 + 500);
  let totalBytes = 0;
  const tickSamples: { bytes: number; ms: number }[] = [];
  const startT = now();
  const deadline = startT + seconds * 1000;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let lastTickT = startT;
  let lastTickBytes = 0;

  ticker = setInterval(() => {
    const t = now();
    const dBytes = totalBytes - lastTickBytes;
    const dMs = t - lastTickT;
    lastTickT = t;
    lastTickBytes = totalBytes;
    if (dMs <= 0) return;
    tickSamples.push({ bytes: dBytes, ms: dMs });
    const mbps = (dBytes * 8) / 1e6 / (dMs / 1000);
    const progress = Math.min(1, (t - startT) / (seconds * 1000));
    emit({ type: "speed", phase: "download", mbps, progress });
  }, 250);

  const worker = async (id: number): Promise<void> => {
    while (now() < deadline && !g.aborted) {
      const url = `${base}${speedtestImagePath(file)}?ck=${randHex(8)}&t=${id}`;
      try {
        await timedDownload(url, (n) => { totalBytes += n; }, g);
      } catch {
        if (g.aborted) return;
        // main file failed — fall back to a smaller one once
        try {
          await timedDownload(`${base}${speedtestImagePath(750)}?ck=${randHex(8)}`, (n) => { totalBytes += n; }, g);
        } catch {
          return;
        }
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: threads }, (_, i) => worker(i)));
  } finally {
    if (ticker) clearInterval(ticker);
    g.cleanup();
  }

  const endT = now();
  const elapsedMs = endT - startT;
  if (totalBytes === 0 || elapsedMs <= 0) return undefined;
  const seconds2 = elapsedMs / 1000;

  // Ookla aggregation: sort samples by speed, drop the two fastest,
  // drop the bottom ~1/4 of what remains, average the rest.
  const speeds = tickSamples
    .filter((s) => s.ms >= 50)
    .map((s) => (s.bytes * 8) / 1e6 / (s.ms / 1000))
    .sort((a, b) => a - b);
  let mbps: number;
  if (speeds.length < 8) {
    mbps = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  } else {
    const noTop2 = speeds.slice(0, speeds.length - 2);
    const cut = Math.floor(noTop2.length / 4);
    const kept = noTop2.slice(cut);
    mbps = kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0;
  }
  const overall = (totalBytes * 8) / 1e6 / seconds2;
  // Report the Ookla-aggregated figure; fall back to overall on anomalies.
  const final = mbps > 0 && Math.abs(mbps - overall) / (overall || 1) < 0.5 ? mbps : overall;

  return {
    mbps: Math.round(final * 100) / 100,
    bytes: totalBytes,
    seconds: Math.round(seconds2 * 10) / 10,
    threads,
    detail: `${threads} threads · random${file}x${file}.jpg · ${formatBytes(totalBytes)} in ${seconds2.toFixed(1)}s`,
  };
}

/* ------------------------------------------------------------------ */
/* Upload phase — pre-test, uniform chunks, up to 4 threads,           */
/* chunks sorted by speed, fastest half averaged.                      */
/* ------------------------------------------------------------------ */

async function timedUpload(
  url: string,
  body: string,
  group: SignalGroup,
): Promise<{ seconds: number; confirmed: number | null }> {
  const t0 = now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
    signal: group.signal,
    cache: "no-store",
  });
  const text = await res.text();
  const seconds = (now() - t0) / 1000;
  const m = text.match(/^size=(\d+)/im);
  return { seconds, confirmed: m ? parseInt(m[1], 10) : null };
}

async function uploadPhase(
  base: string,
  seconds: number,
  parentSignal: AbortSignal,
  emit: (e: HostTestEvent) => void,
): Promise<SpeedResult | undefined> {
  const uploadUrl = `${base}/speedtest/upload.php`;

  /* pre-test: 256 KiB of random data */
  const preSize = 256 * 1024;
  let estimate = 0;
  {
    const g = new SignalGroup([parentSignal], 20000);
    try {
      const body = `content1=${randomChars(preSize - 9)}`;
      const r = await timedUpload(`${uploadUrl}?ck=${randHex(8)}`, body, g);
      estimate = (preSize * 8) / 1e6 / Math.max(r.seconds, 0.001);
    } catch {
      estimate = 0;
    } finally {
      g.cleanup();
    }
  }

  // Ookla rules: >= 4 threads when the estimate is >= 4 Mbit/s; uniform chunks.
  const threads = estimate >= 4 ? 4 : 2;
  const chunkSize = estimate < 10 ? 1 << 20 : estimate < 50 ? 2 << 20 : 4 << 20;
  const body = `content1=${randomChars(chunkSize - 9)}`;

  const g = new SignalGroup([parentSignal], seconds * 1000 + 30000);
  const startT = now();
  const deadline = startT + seconds * 1000;
  const chunkSpeeds: number[] = [];
  let totalBytes = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;

  ticker = setInterval(() => {
    const progress = Math.min(1, (now() - startT) / (seconds * 1000));
    if (chunkSpeeds.length) {
      const recent = chunkSpeeds.slice(-threads * 2);
      const mbps = recent.reduce((a, b) => a + b, 0) / recent.length;
      emit({ type: "speed", phase: "upload", mbps, progress });
    } else {
      emit({ type: "speed", phase: "upload", mbps: 0, progress });
    }
  }, 250);

  const worker = async (id: number): Promise<void> => {
    while (now() < deadline && !g.aborted) {
      try {
        const r = await timedUpload(`${uploadUrl}?ck=${randHex(8)}&t=${id}`, body, g);
        totalBytes += chunkSize;
        if (r.seconds > 0.01) {
          chunkSpeeds.push((chunkSize * 8) / 1e6 / r.seconds);
        }
      } catch (e) {
        if (isAbortError(e) || g.aborted) return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: threads }, (_, i) => worker(i)));
  } finally {
    if (ticker) clearInterval(ticker);
    g.cleanup();
  }

  const elapsedMs = now() - startT;
  if (totalBytes === 0 || elapsedMs <= 0) return undefined;
  const seconds2 = elapsedMs / 1000;

  // Ookla aggregation: sort chunks by speed, average the fastest half.
  const sorted = [...chunkSpeeds].sort((a, b) => a - b);
  const fastestHalf = sorted.slice(Math.floor(sorted.length / 2));
  const mbps =
    fastestHalf.length > 0
      ? fastestHalf.reduce((a, b) => a + b, 0) / fastestHalf.length
      : 0;

  return {
    mbps: Math.round(mbps * 100) / 100,
    bytes: totalBytes,
    seconds: Math.round(seconds2 * 10) / 10,
    threads,
    detail: `${threads} threads · ${formatBytes(chunkSize)} chunks · ${formatBytes(totalBytes)} in ${seconds2.toFixed(1)}s`,
  };
}
