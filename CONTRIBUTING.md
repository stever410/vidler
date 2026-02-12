# Contributing to VIDLER

Thanks for contributing.
This guide defines coding conventions and workflow so changes stay consistent and easy to maintain.

## Engineering Principles

- **KISS**: prefer simple, readable solutions over clever abstractions.
- **DRY**: remove duplicated logic; extract shared helpers when repetition appears.
- **SOLID**: keep modules focused and composable.

## Stack and Tooling

- Language: TypeScript (strict mode)
- Runtime: Node.js `>=16`
- UI: Ink + React
- Formatting/Linting: Biome

Run before every PR:

```bash
pnpm format
pnpm build
```

## Project Conventions

### 1. Module Boundaries

- `source/cli.tsx`: input handling, startup, wiring only.
- `source/core/*`: domain logic, orchestration, retries, strategy contracts.
- `source/strategies/*`: provider-specific adapters.
- `source/utils/*`: side helpers (fs, URL, sanitization).
- `source/app.tsx`: terminal rendering and interaction.

### 2. Code Style

- Use explicit, descriptive names.
- Prefer early returns for validation.
- Keep functions small and focused.
- Avoid side effects in pure helpers.
- Do not use `any`; model data with explicit types.

### 3. Error Handling

- Use typed errors from `source/core/errors.ts` for predictable exit codes.
- Surface actionable messages to users.
- In interactive mode, prefer re-prompting over hard exits for recoverable input errors.

### 4. CLI and UX

- Keep user-facing copy clear and friendly.
- Use semantic colors/icons consistently.
- Preserve keyboard escape routes (`q`, `esc`, `Ctrl+C`).
- Keep JSON/headless output stable for automation.

### 5. Architecture Rules

- Strategy selection must stay in strategy/runtime layers, not in UI.
- Worker retry policy belongs in `worker-pool.ts`.
- UI should subscribe to events; it should not own download business rules.

## Pull Request Checklist

- [ ] Code follows module boundaries above.
- [ ] No duplicated logic introduced.
- [ ] `pnpm format` passes.
- [ ] `pnpm build` passes.
- [ ] CLI output remains understandable in both interactive and headless modes.
- [ ] Docs updated when behavior or commands change.

## Commit Guidance

Use concise, scoped commit messages:

- `feat(ui): add compact metrics panel`
- `refactor(core): extract runtime job runner`
- `fix(cli): re-prompt on invalid output directory`
- `docs(readme): update setup examples`

