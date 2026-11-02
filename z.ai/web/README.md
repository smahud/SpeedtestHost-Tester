# Web — Speedtest Host Tester (Next.js 16)

Runnable source of the web clone. One engine (`src/lib/host-tester.ts`) is
shared with the CLI (`src/cli/main.ts`); the standalone CLI artifact lives at
`../cli/speedtest-host-tester.mjs`.

## Run

```bash
bun install     # or npm install / pnpm install
bun run dev     # http://localhost:3000
```

Enter a host in the single input box — `host`, `host:port`, `[IPv6]:port`, or
a full URL. Missing port defaults to **8080** (the OoklaServer requirement).

## Structure

| Path | Purpose |
| --- | --- |
| `src/app/page.tsx` | the host-tester page UI (single domain input, live progress, 10-check table, PING/DOWNLOAD/UPLOAD cards) |
| `src/app/layout.tsx` | root layout |
| `src/app/globals.css` | global styles (Ookla dark theme) |
| `src/app/api/host-test/route.ts` | `GET /api/host-test?target=…&ds=&us=&ls=` — streams NDJSON events (`start/ip/check/phase/speed/ping-sample/log/done/error`) |
| `src/lib/host-tester.ts` | **the engine** — all checks + measurement methodology |
| `src/lib/host-tester-types.ts` | shared types & constants (image sizes, formatters) |
| `src/cli/main.ts` | CLI source (bundled to the standalone artifact) |
| `src/components/ui/*`, `src/hooks/*`, `src/lib/utils.ts` | the shadcn/ui subset actually imported by the page (import closure: 9 components) |

Notes:

- `next.config.ts` sets `output: "standalone"` and
  `typescript.ignoreBuildErrors` (sandbox defaults) — safe to tighten.
- The scaffold's Prisma pieces (`src/lib/db.ts`, `prisma/schema.prisma`) are
  included for completeness but unused by the host-tester app.
- Fonts (`Geist`) load via `next/font/google` on first build.

## Rebuild the standalone CLI after editing the engine

```bash
bun build src/cli/main.ts --target=node --format=esm \
  --outfile=../cli/speedtest-host-tester.mjs
```
