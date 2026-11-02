/**
 * Shared types & constants for the Speedtest Host Tester engine.
 * Pure data — safe to import from client components.
 */

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus | "running";
  detail?: string;
  durationMs?: number;
}

export interface PingStats {
  min: number;
  avg: number;
  max: number;
  jitter: number;
  samples: number;
  method: string;
}

export interface SpeedResult {
  mbps: number;
  bytes: number;
  seconds: number;
  threads: number;
  detail: string;
}

export interface HostTestSummary {
  target: string;
  host: string;
  port: number;
  ip?: string;
  daemonVersion?: string;
  checks: CheckResult[];
  ping?: PingStats;
  netgaugePing?: PingStats;
  httpPing?: PingStats;
  download?: SpeedResult;
  upload?: SpeedResult;
  verdict: {
    ok: boolean;
    message: string;
    failed: string[];
    passedCount: number;
    failedCount: number;
  };
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export type HostTestEvent =
  | { type: "start"; target: string; host: string; port: number }
  | { type: "ip"; ip: string }
  | { type: "check"; check: CheckResult }
  | { type: "phase"; phase: "latency" | "download" | "upload" | "netgauge"; status: "start" | "end" }
  | { type: "speed"; phase: "download" | "upload"; mbps: number; progress: number }
  | { type: "ping-sample"; ms: number; index: number; total: number }
  | { type: "log"; message: string }
  | { type: "done"; summary: HostTestSummary }
  | { type: "error"; message: string };

export interface RunOptions {
  downloadSeconds?: number;
  uploadSeconds?: number;
  latencySamples?: number;
  netgaugePings?: number;
  timeoutMs?: number;
}

export interface RunHandlers {
  onEvent?: (e: HostTestEvent) => void;
  signal?: AbortSignal;
}

/** The legacy Ookla random download images, in ascending order of size. */
export const SPEEDTEST_IMAGE_SIZES = [
  350, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000,
] as const;

export function speedtestImagePath(size: number): string {
  return `/speedtest/random${size}x${size}.jpg`;
}

/** Checks that must pass for a server to be considered fully configured. */
export const REQUIRED_CHECK_IDS = [
  "resolution",
  "daemon",
  "daemon-version",
  "https",
  "netgauge",
  "keepalive",
  "latency-file",
  "images",
  "upload-script",
  "crossdomain",
] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatMbit(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return "0.00";
  return mbps.toFixed(2);
}
