# core Specification

## Purpose
TBD - created by archiving change add-cli-plan-command. Update Purpose after archive.
## Requirements
### Requirement: Planning Mode (OpenSpec-only writes)
When running `ralphy-sdd plan`, the system MUST operate in a strict "PLAN MODE".

#### Scenario: Plan mode forbids product code changes
- GIVEN `ralphy-sdd plan ...` is executing
- WHEN the backend is invoked
- THEN the instruction payload MUST explicitly forbid changes outside OpenSpec and artifact files
- AND the system MUST treat edits outside allowed paths as a plan failure

### Requirement: Planning Context Pack (deterministic and bounded)
The system MUST build a deterministic, bounded context pack for planning.

The planning context pack MUST include:
- User input (prompt text or PRD file content)
- Reference file contents from `--ref` (bounded)
- `openspec/project.md` (existing project context)
- Existing source-of-truth specs under `openspec/specs/**` if present
- Planning constraints ("PLAN MODE" rules, output requirements)

#### Scenario: Planning context is deterministic
- GIVEN the same repo state and the same inputs
- WHEN `plan` is run twice
- THEN the planning context pack text MUST be identical

#### Scenario: Planning context is bounded
- GIVEN a large number of reference files via `--ref`
- WHEN the planning context pack is built
- THEN the system MUST apply deterministic limits (count and/or bytes)
- AND it MUST record truncation/omissions in the plan run log

### Requirement: Planned tasks MUST be runnable (quality gates)
The planner output MUST produce tasks that are runnable by `ralphy-sdd run` without manual edits.

For each planned task written to `openspec/project.yml`, the system MUST ensure:
- `id` is present and unique within the project
- `title` and `goal` are present
- `sprint.size` is present (XS/S/M/L/XL)
- `sprint.intent` is present (fix/feature/refactor/infra)
- Either:
  - `budget.optimal`, `budget.warning`, `budget.hard` are present, OR
  - sprint defaults apply deterministically (as implemented by spec loader)
- `validators` is present (non-empty) and references declared validators
- `files_contract.allowed` is present (non-empty)
- `acceptance` is present (non-empty), and each acceptance item describes what "DONE" means

#### Scenario: Missing task sizing causes failure
- GIVEN planned tasks missing `sprint.size` or `sprint.intent`
- WHEN `plan` performs structural enforcement
- THEN it MUST fail deterministically with exit code `4`
- AND report which tasks violate requirements

#### Scenario: Validator mapping is consistent
- GIVEN a planned task references `validators: ["typecheck", "test"]`
- WHEN the plan is finalized
- THEN the project spec MUST include validator definitions with ids `typecheck` and `test`

#### Scenario: File contracts are present for scope guarding
- GIVEN a planned task is written to `openspec/project.yml`
- THEN it MUST include a `files_contract` section
- AND `files_contract.allowed` MUST be non-empty

### Requirement: Planning Prompt Reuses Installed Templates
The `plan` command MUST reuse the planning prompt templates installed by `ralphy-sdd init` when available.

#### Scenario: Codex template preferred for codex backend
- GIVEN backend is `codex`
- AND `.codex/prompts/ralphy-plan.md` exists
- WHEN `ralphy-sdd plan` runs
- THEN it MUST use that template as the primary planning instruction payload

#### Scenario: Claude Code template preferred for claude-code backend
- GIVEN backend is `claude-code`
- AND `.claude/commands/ralphy-plan.md` exists
- WHEN `ralphy-sdd plan` runs
- THEN it MUST use that template as the primary planning instruction payload

#### Scenario: Fallback template
- GIVEN no backend-specific planning template exists
- WHEN `ralphy-sdd plan` runs
- THEN it MUST fall back to a built-in minimal planning template that still enforces PLAN MODE constraints

