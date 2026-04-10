# Tasks: add-cli-plan-command

**Change:** `add-cli-plan-command`  
**Version target:** v0.4.0

---

## 1. CLI Surface + Parsing

- [x] **1.1** Add `ralphy-sdd plan` command entrypoint
  - Implementation notes:
    - Create `src/cli/plan.ts` and register it in `src/index.ts` (same pattern as `run`, `init`, `validate`)
    - Support command forms:
      - `ralphy-sdd plan "..."` (treat as prompt text)
      - `ralphy-sdd plan prd.md` (treat as file path if exists)
    - Flags:
      - `--dir <path>` repo root (default: cwd)
      - `--backend <codex|opencode|claude-code|noop>` (default: same as `run`)
      - `--artifact-dir <dir>` (override artifact root; enables artifacts)
      - `--ref <fileOrGlob>` (repeatable; resolve relative to repo root)
      - `--change <slug>` explicit change id/slug
      - `--json` machine-readable output
  - Acceptance criteria:
    - GIVEN `ralphy-sdd plan "hello"` — accepts input as prompt string, exits code 0
    - GIVEN `ralphy-sdd plan prd.md` and `prd.md` exists — reads file contents as planning input
  - Test plan: `npm run typecheck` + unit tests for input disambiguation

## 2. Reference Resolution + Context Pack

- [x] **2.1** Implement `--ref` resolution (repeatable; globs supported)
  - Implementation notes:
    - Use `fast-glob` (already a dependency)
    - Resolve patterns relative to repo root
    - Deduplicate paths, stable-sort for determinism
    - Hard cap total ref files/bytes to keep planning bounded
    - Glob matching zero files → error (exit code 4)
  - Acceptance criteria:
    - `--ref docs/*.md` matches N files → all N included in context
    - Missing refs → exit code 4 with clear error
  - Test plan: unit tests for glob expansion, dedup + sort, "no matches" error

- [x] **2.2** Build a Planning Context Pack
  - Implementation notes:
    - Include: user input, ref file contents (bounded), `openspec/project.md`,
      existing `openspec/specs/**` summaries, strict PLAN MODE constraints
    - Prefer installed planning templates (Codex/Claude Code/OpenCode); fallback to built-in
    - Keep format deterministic and stable
  - Acceptance criteria: backend receives template + context pack + constraints
  - Test plan: unit test snapshot for deterministic output

## 3. Change ID Derivation

- [x] **3.1** Derive `changeId` when `--change` is not provided
  - Implementation notes:
    - Produce kebab-case slug from input text, max 50 chars
    - Add short suffix if collision with existing change folder
  - Acceptance criteria:
    - Derived changeId stable for identical inputs
    - No clobbering of existing non-empty change folders
  - Test plan: unit tests for slug derivation, collision handling

## 4. Backend Invocation

- [x] **4.1** Invoke selected backend for planning
  - Implementation notes:
    - Reuse same backend adapter selection logic as `run`
    - Ensure "PLAN MODE" constraint in payload
    - Enforce scope guard: fail if non-OpenSpec paths modified
  - Acceptance criteria:
    - Backend modifying `src/**` → plan fails with scope violation
  - Test plan: `--backend noop` runs without external tool dependency

## 5. File Outputs + Structural Enforcement

- [x] **5.1** Write OpenSpec change folder and update project files
  - Implementation notes:
    - Create: `openspec/changes/<changeId>/proposal.md`, `tasks.md`, `specs/**`
    - Update: `openspec/project.yml` (tasks + validators), `openspec/project.md` (create if missing)
    - Task ID collision → fail deterministically
  - Acceptance criteria: all files exist and `SpecLoader.loadProjectSpec()` succeeds

- [x] **5.2** Enforce plan output quality gates
  - Implementation notes:
    - Each task MUST have: `sprint.size` + `sprint.intent`, `validators` (referencing declared),
      `files_contract.allowed` (non-empty), `acceptance` (non-empty)
  - Test plan: unit tests for collision detection, quality gate checks

## 6. Post-Plan Validation + Artifacts

- [x] **6.1** Run schema-level validation after planning
  - Implementation notes: `SpecLoader.loadProjectSpec()` + `buildTaskDAG()` + scaffold checks
  - Acceptance criteria: invalid YAML → non-zero exit + error report

- [x] **6.2** Write PLAN completion artifacts
  - Implementation notes:
    - `ralphy-sdd/STATUS.md` with phase "PLAN completed"
    - `ralphy-sdd/runs/<runId>.md` with input summary + validation results
  - Acceptance criteria: STATUS.md shows "PLAN" phase, run log exists

## 7. JSON Output + Exit Codes

- [x] **7.1** Implement `--json` output contract
  - Implementation notes:
    - Success: `{ ok, changeId, runId, writtenFiles, validation, warnings }`
    - Failure: `{ ok: false, exitCode, error }`
    - Exit codes: 0=success, 4=invalid inputs/outputs, 5=backend error, 6=IO error
  - Test plan: unit test for JSON schema shape

## 8. Release Hygiene

- [x] **8.1** Update CLI docs + bump version to v0.4.0
  - Test plan: `npm run typecheck && npm test && npm run build`

---

## Validation Checklist (manual)

- [x] `npm test`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/index.js plan "I want to build a website" --backend noop --json` writes expected files
