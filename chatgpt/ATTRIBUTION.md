# Provenance and reuse

Baseline repository commit: `0b19be0e8e915f04ab836c3ce743a19b557eeef6`.

- `engine.py` is a derivative of `arena.ai/app.py`: target normalization, check order,
  image-size fingerprints, legacy upload arithmetic, row schema and text rendering.
  Transport handling, WebSocket verification, crossdomain policy evaluation,
  KeepAlive validation, public-address filtering and TLS failure handling were revised.
- `cli.py` is derived from `arena.ai/cli.py` v1.2.0, with the local engine import,
  HTTPS scheme behavior, output error handling and submission version updated.
- `app.py`, HTML/CSS, regression tests and the isolated lab harness are new work.
- The official lab reuses the existing `arena.ai/ooklaserver/x86_64/OoklaServer`
  executable, SHA-256 `f19e5ed240dc185bcaf6ca96e0fa40d5ee53e3a543f4c562082ac0d8d92f027a`.
  No binary, font, official logo, certificate or private key is duplicated here.
- Existing Arena, z.ai and Mistral documentation supplied comparison context. Their
  historical results are not presented as tests executed by this submission.

Reuse was explicitly authorized by the repository owner in this task. No new license
is asserted for inherited code or third-party binaries. The upstream repository has
no root license file at the recorded baseline. Ookla and Speedtest names identify the
protocol/product being tested; this implementation is independent and unofficial.
