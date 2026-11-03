#!/usr/bin/env node
/**
 * z.ai Host Tester — regression battery (zero dependencies, Node >= 18).
 *
 * Modes:
 *   node tests/regression.mjs unit   — parseTarget + mock-daemon + CLI behavior
 *                                      (no official binary required)
 *   node tests/regression.mjs lab    — live official-daemon matrix (expects the
 *                                      lab daemon on localhost:8080, valid cert;
 *                                      see lab/README + validation/REPRODUCE.md)
 *
 * Exit code: 0 = all tests passed, 1 = at least one failure.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "cli", "speedtest-host-tester.mjs");
const MOCK = path.join(ROOT, "lab", "probes", "mock-ooklaserver.mjs");

const MODE = process.argv[2] || "unit";
let passCount = 0;
let failCount = 0;
const failures = [];

function ok(name, cond, extra = "") {
  if (cond) {
    passCount++;
    console.log(`  ok   ${name}`);
  } else {
    failCount++;
    failures.push(name + (extra ? ` — ${extra}` : ""));
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function runCli(args, timeoutMs = 120000) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/* ------------------------------------------------------------------ */
/* parseTarget unit tests (import from the engine bundle)              */
/* ------------------------------------------------------------------ */
async function unitParseTarget() {
  console.log("\n[parseTarget]");
  // The engine is TypeScript with extensionless relative imports (TS style).
  // bun resolves it natively; plain Node (>= 22.6) can strip types but not
  // resolve extensionless specifiers — fall back to a bun subprocess then.
  let parseTarget = null;
  const enginePath = path.join(ROOT, "web", "src", "lib", "host-tester.ts");
  try {
    ({ parseTarget } = await import(enginePath));
  } catch {
    const probe = spawnSync("bun", ["-e", `import { parseTarget } from ${JSON.stringify(enginePath)}; console.log(typeof parseTarget);`], { encoding: "utf8" });
    if (probe.stdout.trim() !== "function") {
      ok("engine import (bun or Node>=22.6)", false, "neither succeeded");
      return;
    }
    parseTarget = (input) => JSON.parse(spawnSync("bun", ["-e",
      `import { parseTarget } from ${JSON.stringify(enginePath)}; console.log(JSON.stringify(parseTarget(${JSON.stringify(input)})));`],
      { encoding: "utf8" }).stdout);
  }
  const cases = [
    ["host.example.com", { host: "host.example.com", port: 8080 }],
    ["host.example.com:8080", { host: "host.example.com", port: 8080 }],
    ["host.example.com:9090", { host: "host.example.com", port: 9090 }],
    ["http://host.example.com:8080/", { host: "host.example.com", port: 8080 }],
    ["https://host.example.com", { host: "host.example.com", port: 8080 }],
    ["127.0.0.1", { host: "127.0.0.1", port: 8080 }],
    ["127.0.0.1:8080", { host: "127.0.0.1", port: 8080 }],
    ["[::1]", { host: "::1", port: 8080 }],
    ["[::1]:8080", { host: "::1", port: 8080 }],
    ["[2001:db8::1]:8080", { host: "2001:db8::1", port: 8080 }],
    ["2001:db8::1", { host: "2001:db8::1", port: 8080 }], // bare IPv6, no port
    ["host..example.com", null],          // empty label
    ["-bad.example.com", null],           // leading dash
    ["::1", { host: "::1", port: 8080 }],
    ["host.example.com:notaport", null],  // non-numeric port
    ["256.1.1.1", null],                  // dotted-quad typo, not a hostname
    ["host.example.com:0", null],
    ["host.example.com:65536", null],
    ["", null],
    ["   ", null],
  ];
  for (const [input, expected] of cases) {
    const got = parseTarget(input);
    if (expected === null) {
      ok(`reject ${JSON.stringify(input)}`, got === null, `got ${JSON.stringify(got)}`);
    } else {
      const match = got && got.host === expected.host && got.port === expected.port;
      ok(`parse ${JSON.stringify(input)}`, match, `got ${JSON.stringify(got)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* CLI behavior (no daemon): usage, invalid input, unreachable target  */
/* ------------------------------------------------------------------ */
async function unitCliBehavior() {
  console.log("\n[cli behavior — no daemon needed]");

  let r = runCli(["--help"], 15000);
  ok("--help exits 0", r.code === 0);
  ok("--help prints version", /Speedtest Host Tester v\d+\.\d+\.\d+/.test(r.stdout));

  r = runCli([], 15000);
  ok("no args exits 2", r.code === 2);

  for (const bad of ["!!not a host!!", "host.example.com:notaport", "a b c"]) {
    r = runCli([bad, "--json"], 15000);
    ok(`invalid input ${JSON.stringify(bad)} exits 2`, r.code === 2, `code=${r.code}`);
  }

  // unreachable target: connection refused on a loopback port
  r = runCli(["127.0.0.1:59999", "--json", "--download", "1", "--upload", "1"], 60000);
  let summary = null;
  try { summary = JSON.parse(r.stdout); } catch { /* leave null */ }
  ok("refused target exits 1", r.code === 1, `code=${r.code}`);
  ok("refused target prints valid JSON", summary != null);
  if (summary) {
    ok("refused target verdict not ok", summary.verdict.ok === false);
    ok("refused target fails daemon check", summary.checks.some((c) => c.id === "daemon" && c.status === "fail"));
  }

  // nonexistent host: DNS failure
  r = runCli(["nonexistent.invalid:8080", "--json", "--download", "1", "--upload", "1"], 90000);
  try { summary = JSON.parse(r.stdout); } catch { summary = null; }
  ok("NXDOMAIN exits 1", r.code === 1, `code=${r.code}`);
  ok("NXDOMAIN resolution check fails with DNS error",
    !!summary && summary.checks.some((c) => c.id === "resolution" && c.status === "fail" && /ENOTFOUND|EAI/.test(c.detail ?? "")));
}

/* ------------------------------------------------------------------ */
/* Mock-daemon scenarios                                               */
/* ------------------------------------------------------------------ */
function startMock(port, env = {}) {
  const child = spawn(process.execPath, [MOCK, String(port)], { env: { ...process.env, ...env } });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock daemon did not start")), 8000);
    child.stdout.on("data", (d) => {
      if (/listening/i.test(String(d))) {
        clearTimeout(t);
        resolve(child);
      }
    });
    // fallback: just wait
    setTimeout(() => { clearTimeout(t); resolve(child); }, 1500);
  });
}

async function mockScenarios() {
  console.log("\n[mock daemon — normal mode]");
  let mock = await startMock(8091);
  try {
    let r = runCli(["localhost:8091", "--json", "--download", "1", "--upload", "1"]);
    let s = null;
    try { s = JSON.parse(r.stdout); } catch { /* null */ }
    ok("mock: exit 1 (https fails — no TLS on mock)", r.code === 1, `code=${r.code}`);
    // NOTE: the mock serves plain HTTP only — the https check correctly FAILS
    // against it, so the expected verdict is 9/10 passed / 1 failed (https).
    ok("mock: 9/10 pass + https fail (no TLS on mock)",
      !!s && s.verdict.passedCount === 9 && s.verdict.failedCount === 1 &&
        s.checks.find((c) => c.id === "https")?.status === "fail",
      s ? `${s.verdict.passedCount}/10 failed=${s.verdict.failedCount}` : "no JSON");
    if (s) {
      ok("mock: daemon version detected", (s.daemonVersion ?? "").includes("2.11"));
      ok("mock: crossdomain strict pass (domain=\"*\")",
        s.checks.find((c) => c.id === "crossdomain")?.status === "pass");
    }
  } finally {
    mock.kill();
  }

  console.log("\n[mock daemon — redirect mode (canonical-name 307, like official 2.11)]");
  mock = await startMock(8092, { REDIRECT_MODE: "1", CERT_SANS: "lab.ookla.test,localhost,127.0.0.1" });
  try {
    // 127.0.0.1 is in CERT_SANS -> HTTP endpoints served normally; https
    // still fails (mock has no TLS) -> expected 9/10 + exit 1.
    let r = runCli(["127.0.0.1:8092", "--json", "--download", "1", "--upload", "1"]);
    let s = null;
    try { s = JSON.parse(r.stdout); } catch { /* null */ }
    ok("redirect-mock, Host in SANs: exit 1 (https fails — no TLS on mock)", r.code === 1, `code=${r.code}`);
    ok("redirect-mock, Host in SANs: 9/10 with only https failed",
      !!s && s.verdict.passedCount === 9 && s.verdict.failedCount === 1,
      s ? `${s.verdict.passedCount}/10 failed=${s.verdict.failedCount}` : "no JSON");

    // [::1] NOT in mock CERT_SANS -> endpoint checks must fail with the
    // redirect explanation, NOT a DNS ENOTFOUND error
    r = runCli(["[::1]:8092", "--json", "--download", "1", "--upload", "1"]);
    s = null;
    try { s = JSON.parse(r.stdout); } catch { /* null */ }
    ok("redirect-mock, Host not in SANs: exit 1", r.code === 1, `code=${r.code}`);
    if (s) {
      const str = JSON.stringify(s);
      ok("redirect-mock: no ENOTFOUND DNS errors", !str.includes("ENOTFOUND"));
      ok("redirect-mock: daemon check explains redirect",
        (s.checks.find((c) => c.id === "daemon")?.detail ?? "").includes("redirected to https://"));
      ok("redirect-mock: latency check explains redirect",
        (s.checks.find((c) => c.id === "latency-file")?.detail ?? "").includes("redirected to"));
      ok("redirect-mock: keep-alive inspects 307 headers (pass)",
        s.checks.find((c) => c.id === "keepalive")?.status === "pass");
    } else {
      ok("redirect-mock: JSON parse", false);
    }
  } finally {
    mock.kill();
  }
}

/* ------------------------------------------------------------------ */
/* Live official-daemon lab matrix                                     */
/* ------------------------------------------------------------------ */
async function labMatrix() {
  console.log("\n[live official daemon — localhost:8080, valid lab cert]");
  let r = runCli(["localhost:8080", "--json", "--download", "2", "--upload", "2"]);
  let s = null;
  try { s = JSON.parse(r.stdout); } catch { /* null */ }
  ok("lab localhost: exit 0", r.code === 0, `code=${r.code}`);
  ok("lab localhost: verdict ok, 10/10", !!s && s.verdict.ok && s.verdict.passedCount === 10,
    s ? `${s.verdict.passedCount}/10 ok=${s.verdict.ok}` : "no JSON");
  if (s) {
    ok("lab localhost: daemon version 2.11.5.2", (s.daemonVersion ?? "").includes("2.11.5"));
    ok("lab localhost: crossdomain domain=\"*\" pass",
      (s.checks.find((c) => c.id === "crossdomain")?.detail ?? "").includes('domain="*"'));
    ok("lab localhost: https detail includes trust info", /trust:/.test(s.checks.find((c) => c.id === "https")?.detail ?? ""));
    ok("lab localhost: measurements present", s.ping != null && s.download != null && s.upload != null);
  }

  r = runCli(["127.0.0.1:8080", "--json", "--download", "1", "--upload", "1"]);
  s = null;
  try { s = JSON.parse(r.stdout); } catch { /* null */ }
  ok("lab 127.0.0.1: exit 0 / 10/10", r.code === 0 && !!s && s.verdict.passedCount === 10,
    `code=${r.code} ${s ? `${s.verdict.passedCount}/10` : "no JSON"}`);

  console.log("\n[live official daemon — [::1]:8080 (Host not in SANs due to brackets)]");
  r = runCli(["[::1]:8080", "--json", "--download", "1", "--upload", "1"]);
  s = null;
  try { s = JSON.parse(r.stdout); } catch { /* null */ }
  ok("lab [::1]: exit 1 (endpoints genuinely unreachable via bracketed Host)", r.code === 1, `code=${r.code}`);
  if (s) {
    const str = JSON.stringify(s);
    ok("lab [::1]: NO misleading ENOTFOUND", !str.includes("ENOTFOUND"));
    const daemon = s.checks.find((c) => c.id === "daemon");
    ok("lab [::1]: daemon check passes with redirect explanation",
      daemon?.status === "pass" && /redirected to https:\/\//.test(daemon.detail ?? ""));
    const latency = s.checks.find((c) => c.id === "latency-file");
    ok("lab [::1]: latency check fails with redirect explanation",
      latency?.status === "fail" && /redirected to/.test(latency.detail ?? ""));
    ok("lab [::1]: netgauge works over IPv6",
      s.checks.find((c) => c.id === "netgauge")?.status === "pass");
    ok("lab [::1]: keep-alive inspects 307 headers",
      s.checks.find((c) => c.id === "keepalive")?.status === "pass");
  }
}

/* ------------------------------------------------------------------ */
(async () => {
  console.log(`# z.ai Host Tester regression battery — mode: ${MODE}`);
  if (MODE === "unit") {
    await unitParseTarget();
    await unitCliBehavior();
    await mockScenarios();
  } else if (MODE === "lab") {
    await labMatrix();
  } else {
    console.error("usage: node tests/regression.mjs [unit|lab]");
    process.exit(2);
  }
  console.log(`\n# ${passCount} passed, ${failCount} failed`);
  if (failures.length) {
    console.log("# failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
})();
