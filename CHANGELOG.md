# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-04-10

Forked from [wenqingyu/ralphy-openspec](https://github.com/wenqingyu/ralphy-openspec) with the following changes:

### Added
- **OpenSpec 1.x CLI bridge**: New bridge layer (`src/core/openspec/`) with CLI detection, version check, exec wrapper, and 21 unit tests.
- **Codex backend**: New `src/core/backends/codex.ts` using `codex exec --full-auto` for non-interactive, sandboxed execution.
- **Codex documentation page**: New `docs/src/pages/[lang]/docs/codex.astro` with setup guide, terminal workflow, and tips.
- **GitHub Actions workflow**: CI/CD pipeline for docs deployment to GitHub Pages.

### Changed
- **Project renamed**: `ralphy-openspec` → `ralphy-sdd` (all source code, configs, docs, bin entrypoint, artifact directory).
- **Replaced Cursor with Codex**: Removed `src/core/backends/cursor.ts` and `src/templates/cursor/` templates; updated ToolId, CLI commands, utils, schemas, and docs.
- **Default backend changed**: `cursor` → `codex` in project template.
- **Removed template directories**: Deleted `.cursor/` and `.claude/` template directories.
- **Repo references updated**: All GitHub/npm links updated to `kingtao/ralphy-sdd`.
- **Docs base path**: Added `/ralphy-sdd/` base path support for GitHub Pages deployment; fixed i18n utils, internal links, language picker, and root redirect.
- **Import fixes**: Removed `.js` extensions from imports for CommonJS moduleResolution compatibility.
- **ToolTabs component**: Replaced Cursor tab with Codex tab (default active); now shows Codex / Claude Code / OpenCode.
- **CLI description**: Updated to reflect supported tools (Codex, OpenCode, Claude Code).
- **Removed `CURSOR_API_KEY`** references from README.

### Removed
- `src/core/backends/cursor.ts` — Cursor backend adapter.
- `src/templates/cursor/` — Cursor prompt templates.
- `.cursor/` and `.claude/` template directories.
- Legacy `ralphy-spec/` artifact directory.

---

## Upstream Changelog (wenqingyu/ralphy-openspec)

## [0.3.6] - 2026-01-27

### Added
- **Real-time backend logging**: Backend logs are now written in real-time as output is received, with `[OUT]`/`[ERR]` prefixes for easier debugging.
- **Agent activity reporting**: Cursor backend now detects and reports agent activities (thinking, executing commands, reading files, etc.) in progress messages when output is available.

### Fixed
- Improved error handling in Cursor backend: now properly captures and logs errors even when the process is interrupted externally (SIGTERM, SIGKILL, etc.).
- Backend logs are now always written (best-effort) even if the subprocess throws an exception or is killed, ensuring diagnostic information is preserved.
- Better error messages for process interruptions, distinguishing between timeouts, crashes, and external kills.
- Real-time stdout/stderr capture: output is now captured via event listeners before piping to terminal, ensuring all output is logged even when streaming is enabled.

## [0.3.5] - 2026-01-23

### Fixed
- Backends now respect task budget time limits (`task.budget.hard.time_minutes`) instead of using a fixed 10-minute timeout. This prevents premature termination of longer tasks.
- Improved timeout detection: backends now explicitly detect and report timeouts (using execa's `timedOut` flag) with actionable error messages suggesting task breakdown or budget increases.
- Backend logs now include timeout information (timedOut flag, timeout duration, actual duration) for better debugging.

### Changed
- Timeout error messages now clearly distinguish between timeouts (with budget context) and other termination causes (crashes, external kills).

## [0.3.4] - 2026-01-23

### Added
- Per-iteration backend transcripts under `ralphy-sdd/logs/<runId>/...` (stdout/stderr + metadata), and a backend heartbeat message every 30s while a backend call is running.

## [0.3.3] - 2026-01-23

### Changed
- `ralphy-sdd run` now prints minimal progress updates to stderr (run started, task/iteration, validate), so runs never look "hung" even if the backend is quiet.

## [0.3.2] - 2026-01-23

### Changed
- `ralphy-sdd run` now streams backend output to the terminal by default. Use `--no-stream-backend` to disable (and `--json` remains non-streaming).

## [0.3.1] - 2026-01-23

### Fixed
- `--backend cursor` now invokes **Cursor Agent** (`cursor agent --print ...`) instead of the editor CLI, and provides a clear error when Cursor Agent authentication is missing.

## [0.3.0] - 2026-01-23

### Added
- Budget intelligence: three-tier budgets (optimal → warning → hard) with hard-cap blocking + failure summaries.
- Sprint semantics: `sprint.size` defaults, `sprint.intent` constraints, and configurable scope guard policy (`off|warn|block`).
- Artifact system: `ralphy-sdd/` folder, STATUS/TASKS/BUDGET writers, per-task artifacts, immutable run logs, and `--artifact-dir`.
- New CLI command: `ralphy-sdd budget` and a full CLI docs page on the website.
- Test suite (Vitest) covering the above behaviors.

### Changed
- `ralphy-sdd run` now supports `worktree` mode and real backend selection (`cursor|opencode|claude-code|noop`).
- Docs + README (all languages) updated to reflect the new artifacts and CLI.

## [0.2.0] - 2026-01-23

### Added
- Initial public release of `ralphy-openspec`.
- Astro-powered documentation site with i18n (en/zh/ko/ja).