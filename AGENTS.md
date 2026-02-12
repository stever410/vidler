# AGENTS.md

Instructions for AI coding agents working in this repository.

## Objective

Build and evolve VIDLER as a reliable, user-friendly terminal downloader with clean architecture and predictable CLI behavior.

## Core Rules

- Keep solutions simple and maintainable.
- Preserve SOLID/DRY/KISS boundaries.
- Prefer minimal, targeted edits over broad rewrites.
- Do not silently change CLI contracts.

## Architecture Map

- `source/cli.tsx`: startup, option parsing, interactive prompts, runtime composition.
- `source/app.tsx`: Ink UI state + rendering.
- `source/core/types.ts`: domain contracts.
- `source/core/strategy.ts`: strategy interfaces and registry.
- `source/core/runtime.ts`: orchestration bridge between pool and strategy.
- `source/core/worker-pool.ts`: retries, backoff, worker execution.
- `source/strategies/yt-dlp.ts`: process adapter and strategy set.
- `source/core/binary-manager.ts`: dependency discovery/bootstrap.

## Agent Workflow

1. Read only files relevant to the task.
2. Implement with smallest safe change set.
3. Run validation:
   - `pnpm format`
   - `pnpm build`
4. Summarize changed files and behavior impact.

## UX and Output Rules

- Keep copy friendly and direct.
- Keep interactive mode resilient: re-prompt on recoverable input errors.
- Keep headless mode script-friendly (`--json`, `--no-progress`).
- Keep exit codes stable.

## Safety Rules

- Never use shell interpolation for user input in subprocess execution.
- Keep filesystem writes inside chosen output directory.
- Do not add destructive commands to scripts or docs.

## Dependency Rules

- Avoid new dependencies unless clearly justified.
- If adding a dependency, update docs and explain why it is necessary.

## Definition of Done

A task is done when:

- behavior works,
- code is readable,
- formatting/build pass,
- docs are updated for user-visible changes.

