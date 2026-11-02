"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Square,
  X,
} from "lucide-react";
import {
  formatBytes,
  formatMbit,
  type CheckResult,
  type HostTestSummary,
  type PingStats,
  type SpeedResult,
} from "@/lib/host-tester-types";

type Phase = "idle" | "running" | "done";
type Stage = "checks" | "netgauge" | "latency" | "download" | "upload";

interface LiveState {
  stage: Stage;
  runningCheck: string | null;
  speedMbps: number;
  progress: number;
  pingMs: number | null;
  pingIndex: number;
  pingTotal: number;
  log: string[];
}

const EMPTY_LIVE: LiveState = {
  stage: "checks",
  runningCheck: null,
  speedMbps: 0,
  progress: 0,
  pingMs: null,
  pingIndex: 0,
  pingTotal: 0,
  log: [],
};

function scaleMax(v: number): number {
  const steps = [1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  for (const s of steps) if (v <= s * 0.92) return s;
  return Math.ceil(v * 1.25);
}

function Gauge({ value, phase }: { value: number; phase: "download" | "upload" }) {
  const max = scaleMax(Math.max(value, 1));
  const pct = Math.max(0.02, Math.min(1, value / max));
  const len = Math.PI * 90;
  const color = phase === "download" ? "#4ade80" : "#a78bfa";
  return (
    <div className="relative w-full max-w-[320px]">
      <svg viewBox="0 0 200 116" className="w-full" role="img" aria-label={`${phase} speed gauge`}>
        <path
          d="M10 104 A90 90 0 0 1 190 104"
          fill="none"
          stroke="#232530"
          strokeWidth="13"
          strokeLinecap="round"
        />
        <path
          d="M10 104 A90 90 0 0 1 190 104"
          fill="none"
          stroke={color}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.35s ease, stroke 0.3s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-4xl font-bold tabular-nums" style={{ color }}>
            {value.toFixed(2)}
          </span>
          <span className="text-sm text-zinc-400">Mbps</span>
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">scale 0–{max}</div>
      </div>
    </div>
  );
}

function CheckIcon({ status }: { status: CheckResult["status"] }) {
  if (status === "running")
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" aria-label="running" />;
  if (status === "pass")
    return <Check className="h-4 w-4 shrink-0 text-[#4ade80]" aria-label="pass" />;
  if (status === "warn")
    return <AlertTriangle className="h-4 w-4 shrink-0 text-[#fbbf24]" aria-label="warning" />;
  return <X className="h-4 w-4 shrink-0 text-[#f87171]" aria-label="fail" />;
}

function StatusChip({ status }: { status: CheckResult["status"] }) {
  if (status === "pass")
    return <Badge className="bg-[#4ade80]/15 text-[#4ade80] hover:bg-[#4ade80]/15">PASS</Badge>;
  if (status === "warn")
    return <Badge className="bg-[#fbbf24]/15 text-[#fbbf24] hover:bg-[#fbbf24]/15">WARN</Badge>;
  if (status === "running")
    return <Badge className="bg-zinc-500/15 text-zinc-300 hover:bg-zinc-500/15">RUNNING</Badge>;
  return <Badge className="bg-[#f87171]/15 text-[#f87171] hover:bg-[#f87171]/15">FAIL</Badge>;
}

function MetricCard({
  label,
  value,
  unit,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string | null;
  unit: string;
  sub: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="border-white/5 bg-[#15171e]">
      <CardContent className="p-4 sm:p-6">
        <div
          className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: accent }}
        >
          {icon}
          {label}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-3xl font-bold tabular-nums text-zinc-100 sm:text-4xl">
            {value ?? "—"}
          </span>
          {value != null && <span className="text-sm text-zinc-500">{unit}</span>}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">{sub}</p>
      </CardContent>
    </Card>
  );
}

export default function HostTesterPage() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE);
  const [summary, setSummary] = useState<HostTestSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetInfo, setTargetInfo] = useState<{ target: string; ip?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const upsertCheck = useCallback((c: CheckResult) => {
    setChecks((prev) => {
      const i = prev.findIndex((x) => x.id === c.id);
      if (i === -1) return [...prev, c];
      const copy = [...prev];
      copy[i] = c;
      return copy;
    });
  }, []);

  const startTest = useCallback(async () => {
    const target = input.trim();
    if (!target) {
      setError("Enter a hostname, e.g. speedtest.example.com:8080");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase("running");
    setChecks([]);
    setSummary(null);
    setError(null);
    setLive(EMPTY_LIVE);
    setTargetInfo({ target });

    const params = new URLSearchParams({ target, ds: "10", us: "10", ls: "10" });
    if (new URLSearchParams(window.location.search).get("quick") === "1") {
      params.set("ds", "4");
      params.set("us", "4");
      params.set("ls", "6");
    }

    try {
      const res = await fetch(`/api/host-test?${params.toString()}`, {
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`API error (HTTP ${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: {
            type: string;
            check?: CheckResult;
            ip?: string;
            mbps?: number;
            progress?: number;
            ms?: number;
            index?: number;
            total?: number;
            message?: string;
            status?: string;
            phase?: string;
            summary?: HostTestSummary;
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          switch (ev.type) {
            case "ip":
              setTargetInfo((t) => (t ? { ...t, ip: ev.ip } : t));
              break;
            case "check":
              if (ev.check) {
                upsertCheck(ev.check);
                setLive((l) => ({
                  ...l,
                  runningCheck:
                    ev.check?.status === "running" ? (ev.check?.name ?? null) : null,
                }));
              }
              break;
            case "phase":
              if (ev.status === "start") {
                setLive((l) => ({
                  ...l,
                  stage: (ev.phase as Stage) ?? "checks",
                  speedMbps: 0,
                  progress: 0,
                  pingMs: null,
                  pingIndex: 0,
                }));
              }
              break;
            case "speed":
              setLive((l) => ({
                ...l,
                speedMbps: ev.mbps ?? 0,
                progress: ev.progress ?? 0,
              }));
              break;
            case "ping-sample":
              setLive((l) => ({
                ...l,
                pingMs: ev.ms ?? null,
                pingIndex: ev.index ?? 0,
                pingTotal: ev.total ?? 0,
              }));
              break;
            case "log":
              setLive((l) => ({ ...l, log: [...l.log.slice(-4), ev.message ?? ""] }));
              break;
            case "done":
              setSummary(ev.summary ?? null);
              setPhase("done");
              break;
            case "error":
              setError(ev.message ?? "Unknown error");
              setPhase((p) => (p === "running" ? "done" : p));
              break;
          }
        }
      }
      setPhase((p) => (p === "running" ? "done" : p));
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("done");
      }
    }
  }, [input, upsertCheck]);

  const stopTest = useCallback(() => {
    abortRef.current?.abort();
    setPhase((p) => (p === "running" ? "done" : p));
  }, []);

  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    setPhase("idle");
    setChecks([]);
    setSummary(null);
    setError(null);
    setLive(EMPTY_LIVE);
    setTargetInfo(null);
  }, []);

  const ping: PingStats | undefined = summary?.ping ?? summary?.netgaugePing ?? summary?.httpPing;
  const download: SpeedResult | undefined = summary?.download;
  const upload: SpeedResult | undefined = summary?.upload;

  return (
    <div className="flex min-h-screen flex-col bg-[#0d0e12] text-zinc-100">
      <header className="border-b border-white/5">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
            <path
              d="M4.5 23a11.5 11.5 0 1 1 23 0"
              fill="none"
              stroke="#4ade80"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M16 23 L23.5 13.5" stroke="#e4e4e7" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="16" cy="23" r="2.6" fill="#4ade80" />
          </svg>
          <span className="text-lg font-bold tracking-tight">speedtest</span>
          <Badge
            variant="outline"
            className="border-[#4ade80]/40 bg-[#4ade80]/10 text-[#4ade80] hover:bg-[#4ade80]/10"
          >
            HOST TESTER
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/* ------------------------------------------------ idle ---- */}
        {phase === "idle" && (
          <div className="mx-auto max-w-2xl pt-6 text-center sm:pt-16">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Ookla Server Tester
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
              Use this tool to ensure that your Ookla Server is publicly available and
              properly configured. The Server Tester will verify that the Ookla Server
              daemon is accepting connections, as well as validate the legacy HTTP upload
              script, latency file, download image files, and required server settings
              like KeepAlive.
            </p>

            <Card className="mt-10 border-white/5 bg-[#15171e] text-left">
              <CardContent className="p-6">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void startTest();
                  }}
                  className="flex flex-col gap-4 sm:flex-row sm:items-end"
                >
                  <div className="flex-1">
                    <label
                      htmlFor="server-host"
                      className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400"
                    >
                      Host Server&apos;s Host
                    </label>
                    <Input
                      id="server-host"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="speedtest.example.com:8080"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="h-12 border-white/10 bg-[#0d0e12] font-mono text-base placeholder:text-zinc-600"
                      aria-label="Server hostname and port"
                    />
                    <p className="mt-2 text-xs text-zinc-500">
                      hostname:port — the port defaults to 8080 when omitted
                    </p>
                  </div>
                  <Button
                    type="submit"
                    className="h-12 min-w-[130px] bg-[#4ade80] px-8 text-sm font-bold uppercase tracking-[0.14em] text-[#08130b] hover:bg-[#6ee7a0]"
                  >
                    Submit
                  </Button>
                </form>
                {error && (
                  <p className="mt-4 rounded-md bg-[#f87171]/10 px-3 py-2 text-sm text-[#f87171]" role="alert">
                    {error}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* -------------------------------------------- running / done ---- */}
        {(phase === "running" || phase === "done") && (
          <div>
            {/* target bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
                <span className="font-mono text-zinc-100">{targetInfo?.target}</span>
                {targetInfo?.ip && (
                  <span className="font-mono text-zinc-500">({targetInfo.ip})</span>
                )}
                {summary?.daemonVersion && (
                  <Badge
                    variant="outline"
                    className="border-white/10 bg-white/5 font-mono text-[11px] text-zinc-300 hover:bg-white/5"
                  >
                    {summary.daemonVersion}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                {phase === "running" ? (
                  <Button
                    variant="outline"
                    onClick={stopTest}
                    className="h-10 gap-2 border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                  >
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => void startTest()}
                      className="h-10 gap-2 border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Run again
                    </Button>
                    <Button
                      variant="outline"
                      onClick={resetAll}
                      className="h-10 border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                    >
                      New test
                    </Button>
                  </>
                )}
              </div>
            </div>

            <Separator className="my-6 bg-white/5" />

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              {/* checks column */}
              <Card className="border-white/5 bg-[#15171e]">
                <CardContent className="p-4 sm:p-6">
                  <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Configuration checks
                  </h2>
                  <ul className="space-y-3">
                    {checks.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-start gap-3 rounded-lg border border-white/5 bg-[#0d0e12]/60 p-3"
                      >
                        <span className="mt-0.5">
                          <CheckIcon status={c.status} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-zinc-200">{c.name}</span>
                            {c.durationMs != null && (
                              <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                                {c.durationMs} ms
                              </span>
                            )}
                          </div>
                          {c.detail && (
                            <p className="mt-0.5 break-words font-mono text-xs leading-relaxed text-zinc-500">
                              {c.detail}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                    {checks.length === 0 && (
                      <li className="flex items-center gap-3 p-3 text-sm text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Starting…
                      </li>
                    )}
                  </ul>
                </CardContent>
              </Card>

              {/* live status column */}
              <div className="space-y-6">
                <Card className="border-white/5 bg-[#15171e]">
                  <CardContent className="flex flex-col items-center p-4 sm:p-6">
                    {phase === "running" ? (
                      <>
                        {live.stage === "download" || live.stage === "upload" ? (
                          <>
                            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                              {live.stage === "download" ? (
                                <ArrowDown className="h-4 w-4 text-[#4ade80]" />
                              ) : (
                                <ArrowUp className="h-4 w-4 text-[#a78bfa]" />
                              )}
                              {live.stage} test
                            </div>
                            <Gauge value={live.speedMbps} phase={live.stage} />
                            <Progress
                              value={live.progress * 100}
                              className="mt-4 h-1.5 bg-white/5"
                              aria-label="test progress"
                            />
                          </>
                        ) : live.stage === "latency" ? (
                          <>
                            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                              latency test
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="font-mono text-5xl font-bold tabular-nums text-[#fbbf24]">
                                {live.pingMs ?? "—"}
                              </span>
                              <span className="text-sm text-zinc-400">ms</span>
                            </div>
                            <div className="mt-3 flex gap-1.5" aria-hidden="true">
                              {Array.from({ length: live.pingTotal || 10 }).map((_, i) => (
                                <span
                                  key={i}
                                  className={`h-1.5 w-4 rounded-full ${
                                    i < live.pingIndex ? "bg-[#fbbf24]" : "bg-white/10"
                                  }`}
                                />
                              ))}
                            </div>
                            <p className="mt-3 text-xs text-zinc-500">
                              sample {live.pingIndex}/{live.pingTotal} · lowest value wins
                            </p>
                          </>
                        ) : (
                          <div className="flex flex-col items-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-[#4ade80]" />
                            <p className="mt-4 text-sm font-medium text-zinc-300">
                              {live.stage === "netgauge"
                                ? "Testing netgauge websocket…"
                                : "Validating configuration…"}
                            </p>
                            {live.runningCheck && (
                              <p className="mt-1 text-xs text-zinc-500">{live.runningCheck}</p>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="w-full py-2">
                        <h3
                          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${
                            summary?.verdict.ok
                              ? "bg-[#4ade80]/10 text-[#4ade80]"
                              : "bg-[#f87171]/10 text-[#f87171]"
                          }`}
                        >
                          {summary?.verdict.ok ? (
                            <ShieldCheck className="h-5 w-5 shrink-0" />
                          ) : (
                            <ShieldX className="h-5 w-5 shrink-0" />
                          )}
                          {summary?.verdict.ok ? "All checks passed" : "Issues detected"}
                        </h3>
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                              Ping
                            </span>
                            <span className="font-mono text-sm font-semibold text-[#fbbf24]">
                              {ping ? `${Math.round(ping.min)} ms` : "—"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                              Download
                            </span>
                            <span className="font-mono text-sm font-semibold text-[#4ade80]">
                              {download ? `${formatMbit(download.mbps)} Mbps` : "—"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                              Upload
                            </span>
                            <span className="font-mono text-sm font-semibold text-[#a78bfa]">
                              {upload ? `${formatMbit(upload.mbps)} Mbps` : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {live.log.length > 0 && (
                  <Card className="border-white/5 bg-[#15171e]">
                    <CardContent className="p-4">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        Log
                      </p>
                      <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-zinc-500">
                        {live.log.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* ---------------------------------------- done: full results ---- */}
            {phase === "done" && summary && (
              <div className="mt-8 space-y-6">
                <div
                  className={`flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center ${
                    summary.verdict.ok
                      ? "border-[#4ade80]/30 bg-[#4ade80]/5"
                      : "border-[#f87171]/30 bg-[#f87171]/5"
                  }`}
                >
                  {summary.verdict.ok ? (
                    <ShieldCheck className="h-8 w-8 shrink-0 text-[#4ade80]" />
                  ) : (
                    <ShieldX className="h-8 w-8 shrink-0 text-[#f87171]" />
                  )}
                  <div className="min-w-0">
                    <p
                      className={`font-semibold ${
                        summary.verdict.ok ? "text-[#4ade80]" : "text-[#f87171]"
                      }`}
                    >
                      {summary.verdict.message}
                    </p>
                    {summary.verdict.failed.length > 0 && (
                      <p className="mt-1 text-sm text-zinc-400">
                        Failed: {summary.verdict.failed.join(" · ")}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-zinc-500">
                      {summary.verdict.passedCount} passed / {summary.verdict.failedCount} failed
                      · completed in {(summary.durationMs / 1000).toFixed(1)}s
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <MetricCard
                    label="Ping"
                    value={ping ? String(Math.round(ping.min)) : null}
                    unit="ms"
                    sub={
                      ping
                        ? `min ${ping.min} · avg ${ping.avg} · jitter ${ping.jitter} · ${ping.samples} samples · ${ping.method}`
                        : "latency unavailable"
                    }
                    accent="#fbbf24"
                    icon={<span className="font-mono text-xs">ms</span>}
                  />
                  <MetricCard
                    label="Download"
                    value={download ? formatMbit(download.mbps) : null}
                    unit="Mbps"
                    sub={download ? download.detail : "skipped — no download images"}
                    accent="#4ade80"
                    icon={<ArrowDown className="h-3.5 w-3.5" />}
                  />
                  <MetricCard
                    label="Upload"
                    value={upload ? formatMbit(upload.mbps) : null}
                    unit="Mbps"
                    sub={upload ? upload.detail : "skipped — upload.php unusable"}
                    accent="#a78bfa"
                    icon={<ArrowUp className="h-3.5 w-3.5" />}
                  />
                </div>

                <Card className="border-white/5 bg-[#15171e]">
                  <CardContent className="p-4 sm:p-6">
                    <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      Test results
                    </h2>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-white/5">
                            <TableHead className="text-zinc-400">Check</TableHead>
                            <TableHead className="w-[90px] text-zinc-400">Result</TableHead>
                            <TableHead className="text-zinc-400">Details</TableHead>
                            <TableHead className="w-[80px] text-right text-zinc-400">
                              Time
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {summary.checks.map((c) => (
                            <TableRow key={c.id} className="border-white/5">
                              <TableCell className="py-3 pr-4 font-medium text-zinc-200">
                                <span className="flex items-center gap-2">
                                  <CheckIcon status={c.status} />
                                  {c.name}
                                </span>
                              </TableCell>
                              <TableCell className="py-3 pr-4">
                                <StatusChip status={c.status} />
                              </TableCell>
                              <TableCell className="max-w-[420px] py-3 pr-4 font-mono text-xs leading-relaxed text-zinc-500">
                                {c.detail ?? "—"}
                              </TableCell>
                              <TableCell className="py-3 text-right font-mono text-xs text-zinc-500">
                                {c.durationMs != null ? `${c.durationMs} ms` : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="mt-4 text-xs text-zinc-600">
                      Measured from this service toward {summary.target}
                      {summary.ip ? ` (${summary.ip})` : ""} ·{" "}
                      {formatBytes((download?.bytes ?? 0) + (upload?.bytes ?? 0))} of test
                      traffic transferred
                    </p>
                  </CardContent>
                </Card>

                {error && (
                  <p
                    className="rounded-md bg-[#f87171]/10 px-4 py-3 text-sm text-[#f87171]"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="mt-auto border-t border-white/5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-5 text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Independent clone of the Ookla® Server Tester workflow — daemon, netgauge
            WebSocket, HTTPS, KeepAlive, latency file, download images, upload script,
            crossdomain.
          </p>
          <p className="font-mono">no captcha · no ads · just the test</p>
        </div>
      </footer>
    </div>
  );
}
