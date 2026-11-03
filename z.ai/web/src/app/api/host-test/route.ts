import type { NextRequest } from "next/server";
import { runHostTest } from "@/lib/host-tester";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function clamp(v: number | null, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Concurrency guard: each test opens 2–4 download threads + up to 4 upload
 * workers against the target. Unbounded concurrent runs could exhaust local
 * resources (sockets, memory) — cap the simultaneous in-process tests.
 */
const MAX_CONCURRENT_TESTS = 3;
let activeTests = 0;

/**
 * GET /api/host-test?target=host.example.com:8080&ds=10&us=10&ls=10
 * Streams NDJSON events (start/check/phase/speed/ping-sample/log/done/error).
 *
 * NOTE (security posture): this route is designed for LOCAL / lab use — it
 * willfully connects to loopback and private addresses because testing an
 * OoklaServer on the local network is the tool's purpose. Do not expose it
 * publicly without an authentication layer and an egress allowlist.
 */
export async function GET(req: NextRequest) {
  if (activeTests >= MAX_CONCURRENT_TESTS) {
    return Response.json(
      { error: `Too many concurrent tests (max ${MAX_CONCURRENT_TESTS}). Try again shortly.` },
      { status: 429 },
    );
  }
  activeTests++;
  try {
    return await streamTest(req);
  } finally {
    activeTests--;
  }
}

async function streamTest(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const target = (searchParams.get("target") || "").trim();

  const ds = clamp(Number(searchParams.get("ds")), 10, 2, 30);
  const us = clamp(Number(searchParams.get("us")), 10, 2, 30);
  const ls = clamp(Number(searchParams.get("ls")), 10, 3, 30);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };

      if (!target) {
        send({
          type: "error",
          message: "Missing target. Use /api/host-test?target=hostname:port",
        });
        controller.close();
        return;
      }

      try {
        await runHostTest(
          target,
          { onEvent: (e) => send(e), signal: req.signal },
          {
            downloadSeconds: ds,
            uploadSeconds: us,
            latencySamples: ls,
            timeoutMs: (ds + us) * 1000 + 90000,
          },
        );
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
