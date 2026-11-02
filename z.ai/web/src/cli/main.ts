#!/usr/bin/env node
/**
 * Speedtest Host Tester — CLI
 * Validates an Ookla® Speedtest server the same way speedtest.net's
 * Server Tester does: daemon connection, netgauge WebSocket, HTTPS,
 * KeepAlive, latency file, download images, legacy upload script,
 * crossdomain — plus ping / download / upload measurements.
 *
 * Usage:
 *   node speedtest-host-tester.mjs <hostname[:port]> [options]
 *
 * Options:
 *   --json             Print a machine-readable JSON summary only
 *   --no-color         Disable ANSI colors
 *   --download <sec>   Download test duration in seconds (default 10)
 *   --upload <sec>     Upload test duration in seconds (default 10)
 *   --samples <n>      Latency samples (default 10)
 *   --timeout <sec>    Global timeout in seconds (default 150)
 *   -h, --help         Show this help
 *
 * Requires Node.js >= 18. Zero dependencies.
 */

import { runHostTest, parseTarget } from "../lib/host-tester";
import { formatBytes, formatMbit } from "../lib/host-tester-types";

const VERSION = "1.0.1";

/* ------------------------------ flags ------------------------------ */

interface CliArgs {
  target: string | null;
  json: boolean;
  color: boolean;
  download: number;
  upload: number;
  samples: number;
  timeout: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    target: null,
    json: false,
    color: process.stdout.isTTY !== false,
    download: 10,
    upload: 10,
    samples: 10,
    timeout: 150,
    help: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--json": args.json = true; break;
      case "--no-color": args.color = false; break;
      case "-h": case "--help": args.help = true; break;
      case "--download": args.download = num(argv[++i], "download"); break;
      case "--upload": args.upload = num(argv[++i], "upload"); break;
      case "--samples": args.samples = num(argv[++i], "samples"); break;
      case "--timeout": args.timeout = num(argv[++i], "timeout"); break;
      default:
        if (a.startsWith("--")) { fail(`unknown option: ${a}`); }
        rest.push(a);
    }
  }
  args.target = rest.length > 0 ? rest[0] : null;
  return args;
}

function num(v: string | undefined, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`invalid value for --${name}: ${v}`);
  return n;
}

function fail(msg: string): never {
  process.stderr.write(`Error: ${msg}\nRun with --help for usage.\n`);
  process.exit(2);
}

/* ------------------------------ color ------------------------------ */

let USE_COLOR = true;
const c = {
  reset: () => (USE_COLOR ? "\x1b[0m" : ""),
  dim: (s: string) => (USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  violet: (s: string) => (USE_COLOR ? `\x1b[35m${s}\x1b[0m` : s),
  cyan: (s: string) => (USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s),
};

function write(s: string): void {
  process.stdout.write(s);
}

function clearLine(): void {
  write("\r\x1b[2K");
}

/* ------------------------------ help ------------------------------- */

function printHelp(): void {
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

/* ------------------------------ main ------------------------------- */

async function main(): Promise<number> {
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

  const ctrl = new AbortController();
  const onSigint = () => {
    ctrl.abort();
  };
  process.on("SIGINT", onSigint);

  let spinnerTimer: ReturnType<typeof setInterval> | null = null;
  let spinnerLabel = "";
  let lastSpeedLine = "";

  if (!args.json) {
    write("\n");
    write(`  ${c.bold("Speedtest Host Tester")} ${c.dim(`v${VERSION}`)}\n`);
    write(`  ${c.dim("Ookla Server validation — same checks as speedtest.net/host-tester")}\n`);
    write("\n");
    write(`  Target   ${c.cyan(parsed.host + ":" + parsed.port)}\n`);
    write(`  Started  ${c.dim(new Date().toLocaleString())}\n`);
    write("\n");
  }

  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
      clearLine();
    }
  };

  const startSpinner = (label: string) => {
    if (args.json) return;
    stopSpinner();
    spinnerLabel = label;
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    spinnerTimer = setInterval(() => {
      write(`\r\x1b[2K  ${c.cyan(frames[i++ % frames.length])} ${label}`);
    }, 90);
  };

  try {
    const summary = await runHostTest(
      args.target,
      {
        signal: ctrl.signal,
        onEvent: (ev) => {
          if (ev.type === "check") {
            const ck = ev.check;
            if (ck.status === "running") {
              startSpinner(ck.name);
              return;
            }
            stopSpinner();
            if (!args.json) printCheck(ck.name, ck.status, ck.detail, ck.durationMs);
          } else if (ev.type === "ip") {
            if (!args.json) {
              const label = spinnerLabel;
              stopSpinner();
              write(`  IP       ${c.dim(ev.ip)}\n`);
              if (label) startSpinner(label);
            }
          } else if (ev.type === "phase") {
            if (ev.phase === "download" || ev.phase === "upload") {
              if (ev.status === "start") {
                lastSpeedLine = "";
              } else {
                if (!args.json && lastSpeedLine) {
                  clearLine();
                  lastSpeedLine = "";
                  write("\n");
                }
              }
            }
          } else if (ev.type === "speed" && !args.json) {
            const barLen = 24;
            const filled = Math.round(ev.progress * barLen);
            const bar = "█".repeat(filled) + c.dim("░".repeat(barLen - filled));
            const icon = ev.phase === "download" ? "↓" : "↑";
            const col = ev.phase === "download" ? c.green : c.violet;
            const line =
              `  ${col(icon)} ${ev.phase === "download" ? "Download" : "Upload  "}` +
              `  ${c.bold(ev.mbps.toFixed(2).padStart(8))} Mbps  ${bar} ${Math.round(ev.progress * 100)}%`;
            write("\r\x1b[2K" + line);
            lastSpeedLine = line;
          } else if (ev.type === "log" && !args.json) {
            if (lastSpeedLine) {
              clearLine();
              lastSpeedLine = "";
            }
            write(`  ${c.dim("· " + ev.message)}\n`);
          }
        },
      },
      {
        downloadSeconds: args.download,
        uploadSeconds: args.upload,
        latencySamples: args.samples,
        timeoutMs: args.timeout * 1000,
      },
    );

    stopSpinner();
    process.off("SIGINT", onSigint);

    if (args.json) {
      write(JSON.stringify(summary, null, 2) + "\n");
      return summary.verdict.ok ? 0 : 1;
    }

    // measurements
    write("\n");
    const ping = summary.ping;
    write(`  ${c.yellow("Ping")}     ${c.bold(String(ping ? ping.min.toFixed(1) : "—").padStart(9))} ms`);
    if (ping) write(c.dim(`   min ${ping.min} / avg ${ping.avg} / jitter ${ping.jitter} (${ping.samples} samples, ${ping.method})`));
    write("\n");
    const dl = summary.download;
    write(`  ${c.green("Download")}${c.bold(String(dl ? formatMbit(dl.mbps) : "—").padStart(9))} Mbps`);
    if (dl) write(c.dim(`   ${dl.detail}`));
    write("\n");
    const ul = summary.upload;
    write(`  ${c.violet("Upload")}  ${c.bold(String(ul ? formatMbit(ul.mbps) : "—").padStart(9))} Mbps`);
    if (ul) write(c.dim(`   ${ul.detail}`));
    write("\n");
    write(
      `  ${c.dim("Traffic")}  ${formatBytes((dl?.bytes ?? 0) + (ul?.bytes ?? 0))} transferred in ${(summary.durationMs / 1000).toFixed(1)}s\n`,
    );
    write("\n");

    if (summary.verdict.ok) {
      write(`  ${c.green(c.bold("✔ " + summary.verdict.message))}\n\n`);
    } else {
      write(`  ${c.red(c.bold("✘ " + summary.verdict.message))}\n`);
      for (const f of summary.verdict.failed) write(`    ${c.red("•")} ${f}\n`);
      write("\n");
    }
    write(
      `  ${c.dim(`${summary.verdict.passedCount} passed / ${summary.verdict.failedCount} failed · ${summary.target}`)}\n\n`,
    );

    return summary.verdict.ok ? 0 : 1;
  } catch (e) {
    stopSpinner();
    process.off("SIGINT", onSigint);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted") || (e instanceof Error && e.name === "AbortError") || ctrl.signal.aborted) {
      if (!args.json) write("\n  Aborted.\n\n");
      return 130;
    }
    if (args.json) {
      write(JSON.stringify({ error: msg }) + "\n");
    } else {
      write(`\n  ${c.red("✘ " + msg)}\n\n`);
    }
    return 1;
  }
}

function printCheck(
  name: string,
  status: string,
  detail?: string,
  durationMs?: number,
): void {
  const label = name.length >= 44 ? name.slice(0, 43) + "…" : name;
  const dots = ".".repeat(Math.max(3, 44 - label.length));
  let icon: string;
  let word: string;
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
  if (det.length > 110) det = det.slice(0, 107) + "…";
  write(`  ${icon} ${label} ${c.dim(dots)} ${word}${time}${det ? c.dim("  " + det) : ""}\n`);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
