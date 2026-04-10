## Why

ralphy-sdd currently re-implements OpenSpec directory conventions (scaffold creation, basic validation, manual archive) in-house. The official OpenSpec CLI (`@fission-ai/openspec` v1.x) provides richer capabilities—delta spec semantic validation, enriched instruction generation, schema-driven workflows, and automated archive with spec-apply. Integrating the official CLI via a lightweight bridge would:

1. Leverage official spec validation (requirement/scenario structure, SHALL/MUST enforcement, delta integrity)
2. Enable `openspec instructions` for richer context in the planned `plan` command
3. Use `openspec archive` for safe, validated archive-with-spec-apply
4. Reduce maintenance of hand-rolled OpenSpec directory logic
5. Stay compatible with the broader OpenSpec ecosystem and future versions

## What Changes

- **ADDED**: `OpenSpecBridge` module (`src/core/openspec/`) that auto-detects the `openspec` CLI, wraps its commands via `execa`, and parses JSON output
- **MODIFIED**: `src/utils/installer.ts` to delegate to `openspec init` when CLI is available (fallback to built-in scaffold)
- **MODIFIED**: `src/utils/validator.ts` to delegate to `openspec validate --json` when CLI is available (fallback to built-in checks)
- **ADDED**: Archive bridge (`src/core/openspec/archive.ts`) wrapping `openspec archive --yes`
- **ADDED**: Change + Instructions bridge (`src/core/openspec/change.ts`) wrapping `openspec new change` and `openspec instructions --json`
- **ADDED**: Query bridge (`src/core/openspec/query.ts`) wrapping `openspec list --json` and `openspec status --json`
- **MODIFIED**: CLI commands (`src/cli/init.ts`, `src/cli/validate.ts`) to pass through relevant OpenSpec options
- **ADDED**: `openspec/config.yaml` project-level OpenSpec configuration

## Capabilities

### New Capabilities
- `openspec-bridge`: CLI detection, command execution, JSON parsing, fallback strategy

### Modified Capabilities
- (none — existing ralphy-sdd behavior is preserved as fallback)

## Impact

- **Dependencies**: No new npm dependencies (uses existing `execa`). Requires optional global install of `@fission-ai/openspec` >= 1.0.0.
- **Code**: New module `src/core/openspec/` (~4-5 files). Minor changes to `src/utils/installer.ts`, `src/utils/validator.ts`, and 2-3 CLI files.
- **Config**: New optional `openspec/config.yaml` for project-level schema/context settings.
- **Backward compatibility**: 100% — all bridge calls fallback to built-in logic when CLI is absent.

## Non-Goals

- Replacing the built-in `SpecLoader` / `project.yml` parsing (that stays as-is)
- Adding `@fission-ai/openspec` as an npm dependency (CLI bridge only, not SDK)
- Changing the `openspec/project.yml` format or schema
- Implementing the `ralphy-sdd plan` command (separate change)
- Supporting OpenSpec 2.x breaking changes (future work)

## Risks / Mitigations

| Risk | Mitigation |
|------|-----------|
| User doesn't have openspec CLI installed | Graceful fallback to built-in implementation; clear log message suggesting install |
| CLI output format changes in future versions | Pin minimum version >= 1.0.0; parse JSON defensively with zod |
| CLI command hangs or times out | Apply configurable timeout (default 30s) via execa |
| Version incompatibility | Version check on first use; warn if < 1.0.0 |

## Success Criteria

- `ralphy-sdd init` with openspec CLI installed uses `openspec init` under the hood
- `ralphy-sdd validate` shows richer validation (delta spec checks) when openspec CLI is available
- `ralphy-sdd init` / `validate` work identically (built-in fallback) when openspec CLI is NOT installed
- All existing tests continue to pass (`npm run typecheck && npm test`)
- New unit tests cover bridge detection, fallback, and JSON parsing
