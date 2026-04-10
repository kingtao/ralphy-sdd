## Why

The project was forked from upstream which used Cursor as the primary AI backend. Cursor CLI is not available in our environment. We want to replace it with Codex CLI (`codex-cli`) which IS available and provides a clean non-interactive `codex exec` command with `--full-auto` mode.

## What Changes

- **REMOVED**: `src/core/backends/cursor.ts` — Cursor backend adapter (~340 lines)
- **REMOVED**: `src/templates/cursor/` — Cursor prompt templates
- **ADDED**: `src/core/backends/codex.ts` — Codex backend adapter using `codex exec`
- **MODIFIED**: `src/types.ts` — Replace `"cursor"` with `"codex"` in `ToolId` union
- **MODIFIED**: `src/cli/run.ts` — Replace cursor import/case with codex
- **MODIFIED**: `src/cli/init.ts` — Replace cursor references with codex
- **MODIFIED**: `src/cli/validate.ts` — Replace cursor references with codex
- **MODIFIED**: `src/cli/update.ts` — Replace cursor references with codex
- **MODIFIED**: `src/utils/detector.ts` — Detect codex instead of cursor
- **MODIFIED**: `src/utils/installer.ts` — Remove cursor template install, update default backend
- **MODIFIED**: `src/utils/validator.ts` — Validate codex instead of cursor
- **MODIFIED**: `src/core/spec/schemas.ts` — Change default backend from cursor to opencode

## Non-Goals

- Adding Codex-specific prompt templates (use shared templates for now)
- Supporting Codex Cloud features (future work)

## Risks / Mitigations

| Risk | Mitigation |
|------|-----------|
| Codex exec output format differs from cursor | Parse exit code + stdout, keep it simple |
| Codex sandbox mode may block file writes | Use `--full-auto` which enables workspace-write sandbox |
