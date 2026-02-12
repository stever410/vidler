# Plan: Build `vidler` v1 Multi-Site Video Downloader CLI

## Summary
Implement a strategy-based CLI downloader that accepts one URL, auto-detects site/provider from URL patterns, downloads via a `yt-dlp`-backed strategy layer, runs downloads through a worker model (v1 concurrency mostly future-proofed for multiple jobs), and renders live progress in Ink (per-job row + global summary).  
V1 targets robust end-to-end behavior with clear extension points for future native site strategies and batch mode.

## Product Scope and Decisions (Locked)
- Input mode: command arguments (non-interactive by default).
- URL count in v1: single URL per invocation.
- Site support model: generic multi-site via `yt-dlp` backend (YouTube/TikTok/Facebook and other supported sites).
- Strategy pattern: keep explicit strategy interfaces now, with `YtDlpStrategy` as default implementation.
- Concurrency model: worker-pool architecture for parallel jobs (v1 runs one job now, but engine supports >1 later).
- Progress UI: per-job progress + global summary in Ink.
- Retry policy: 3 retries with exponential backoff on transient failures.
- Output behavior: user chooses quality; output directory defaults to `./output` in current working directory.
- Runtime dependencies: auto-bootstrap/download binaries (`yt-dlp`, `ffmpeg`) when missing.

## Proposed CLI Contract
- Command:
  - `vidler <url> [options]`
- Options:
  - `--quality <value>`: `best|worst|720p|1080p|...` (default: `best`)
  - `--output <dir>`: target directory (default: `./output`)
  - `--filename <template>`: optional output name template
  - `--concurrency <n>`: worker pool size (default: `4`, mostly future-ready in v1)
  - `--retries <n>`: retry attempts (default: `3`)
  - `--timeout <sec>`: per-attempt timeout
  - `--no-progress`: disable Ink live UI (CI/log mode)
  - `--json`: emit machine-readable events/results
  - `--verbose`: detailed logs
- Exit codes:
  - `0` success
  - `1` runtime/download error
  - `2` invalid input/unsupported URL
  - `3` dependency/bootstrap failure

## Architecture
1. **Domain types**
- `DownloadRequest`: url, quality, outputDir, filenameTemplate, retries, timeoutSec
- `DownloadJob`: id, request, detectedProvider
- `DownloadProgress`: status, percent, downloadedBytes, totalBytes, speedBps, etaSec
- `DownloadResult`: success/failure metadata, filePath, durationMs, provider
- `ProviderKind`: `youtube | tiktok | facebook | generic`

2. **Strategy layer**
- `DownloadStrategy` interface:
  - `canHandle(url: URL): boolean`
  - `prepare(job): Promise<PreparedJob>`
  - `download(prepared, emitter): Promise<DownloadResult>`
- Implementations:
  - `YtDlpStrategy` (primary v1 strategy)
  - `FallbackStrategy` alias to `YtDlpStrategy` for unknown providers
- `StrategyRegistry`:
  - URL pattern match first (youtube/tiktok/facebook)
  - fallback generic strategy
  - designed to add future native site strategies without changing orchestrator

3. **Worker/orchestration layer**
- `DownloadQueue` and `WorkerPool` abstraction:
  - consumes jobs, executes with `concurrency` workers
  - emits standardized events: `jobStarted`, `jobProgress`, `jobRetry`, `jobCompleted`, `jobFailed`
- v1 behavior:
  - single URL enqueued, worker pool still used for architecture consistency
  - code paths already support multiple jobs later

4. **Dependency/bootstrap service**
- `BinaryManager`:
  - resolve local cache path (e.g., `~/.cache/vidler/bin` or platform equivalent)
  - detect existing `yt-dlp` and `ffmpeg`
  - if missing, download compatible binaries and mark executable
  - verify versions and basic health checks
- startup sequence:
  - validate URL/options
  - ensure binaries available
  - continue to strategy execution

5. **Adapter for `yt-dlp` process**
- Spawn process with args derived from `DownloadRequest`
- Parse progress output (`--newline --progress` compatible flags)
- Map parser output into `DownloadProgress` events
- Handle cancellation, timeout, retryable/non-retryable classification

6. **UI layer (Ink)**
- Components:
  - `DownloadScreen`
  - `JobRow` (status, bar, speed, ETA, bytes)
  - `SummaryRow` (active/completed/failed, aggregate throughput, elapsed time)
- Non-TTY fallback:
  - plain log lines or JSON events when `--json` or no terminal

## File/Module Plan (suggested)
- `source/cli.tsx`: parse args and bootstrap app runtime
- `source/app.tsx`: top-level Ink app binding events to UI state
- `source/core/types.ts`: domain types/interfaces
- `source/core/strategy.ts`: strategy interface + registry
- `source/strategies/yt-dlp.ts`: `YtDlpStrategy`
- `source/core/worker-pool.ts`: queue + workers + retry orchestration
- `source/core/binary-manager.ts`: binary discovery/download/verification
- `source/core/progress-parser.ts`: parse `yt-dlp` progress lines
- `source/core/errors.ts`: typed errors + retryability
- `source/utils/url-detect.ts`: provider detection and normalization
- `source/utils/fs.ts`: output directory and filename helpers

## Retry/Failure Rules
- Retryable:
  - network timeouts, transient HTTP 5xx, connection resets, DNS temporary failures
- Non-retryable:
  - invalid URL, unsupported extractor, permission denied, 4xx likely permanent
- Backoff:
  - base 500ms, factor 2, jitter ±20%, max 3 attempts by default
- Final failure:
  - include short actionable reason and original stderr snippet

## Output and Naming Rules
- Default output directory: `./output` (create if absent)
- Quality selection:
  - pass user selection directly into format selection logic
  - fallback to `best` when invalid value detected (with warning)
- Filename:
  - default from provider metadata/title sanitized for filesystem
  - collision behavior: append numeric suffix

## Security and Guardrails
- URL validation:
  - require `http`/`https` scheme
  - reject local file paths and unsupported schemes
- Process spawning:
  - pass arguments as array (no shell interpolation)
- File writes:
  - restricted to selected output directory

## Testing Plan
1. **Unit tests**
- URL/provider detection (`youtube`, `tiktok`, `facebook`, unknown)
- strategy registry resolution and fallback behavior
- progress parser line variants and malformed input handling
- retry classifier and backoff timing logic
- filename sanitization and collision handling

2. **Integration tests (mocked process)**
- successful download flow event sequence
- transient failure then success after retries
- permanent failure with correct exit code and message
- binary bootstrap missing -> download -> verify path selected

3. **CLI behavior tests**
- required URL argument enforcement
- options parsing (`quality`, `output`, `retries`, `json`)
- non-TTY behavior without Ink live rendering
- JSON output schema stability for automation consumers

4. **Manual acceptance scenarios**
- YouTube URL, `--quality best`, output in `./output`
- TikTok URL with explicit `--output ./videos`
- Facebook URL with transient network interruption and retry recovery
- Missing binary on first run triggers bootstrap and then successful download

## Important Public Interfaces/Types
- `DownloadStrategy` interface (extensibility contract)
- CLI options contract for `vidler <url> [options]`
- Progress event payload shape for Ink and optional JSON mode
- `DownloadResult` shape (includes `provider`, `filePath`, status metadata)

## Milestones
1. Core domain + CLI option parsing + typed errors
2. Strategy registry + `YtDlpStrategy` + process adapter
3. Worker orchestration + retry engine
4. Binary auto-bootstrap manager
5. Ink progress UI + non-TTY/json output
6. Tests + README usage docs + troubleshooting section

## Assumptions and Defaults
- Node runtime in this repo is sufficient for child process + streams.
- `yt-dlp` remains the source of extractor logic for all supported providers in v1.
- Worker-pool design is implemented now, but v1 command processes one URL per invocation.
- Default `concurrency=4` is retained for future batch mode and internal parallel task readiness.
- ffmpeg is required for some formats/merging; bootstrap handles missing dependency automatically.
