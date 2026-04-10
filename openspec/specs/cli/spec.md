# cli Specification

## Purpose
TBD - created by archiving change add-cli-plan-command. Update Purpose after archive.
## Requirements
### Requirement: Plan Command (CLI entrypoint)
The CLI MUST provide a `plan` command that generates OpenSpec planning artifacts from a prompt or PRD file.

#### Scenario: Plan from prompt text
- GIVEN a repo with `openspec/` scaffold
- WHEN `ralphy-sdd plan "I want to build a website for my xxx"`
- THEN it MUST generate a new change folder under `openspec/changes/<changeId>/`
- AND it MUST update `openspec/project.yml` so that `ralphy-sdd run --dry-run` succeeds
- AND it MUST write `ralphy-sdd/STATUS.md` indicating PLAN completed

#### Scenario: Plan from PRD file path
- GIVEN a file `prd.md` exists
- WHEN `ralphy-sdd plan prd.md`
- THEN it MUST treat the input as a file path (not a literal prompt string)
- AND it MUST include `prd.md` contents in the planning context

### Requirement: Plan Flags (minimum)
The `plan` command MUST support the following flags:

- `--dir <path>`: repo root (default: current working directory)
- `--backend <codex|opencode|claude-code|noop>`: planning backend (default: same resolution behavior as `run`)
- `--artifact-dir <dir>`: override artifact root directory (enables artifacts)
- `--ref <fileOrGlob>` (repeatable): reference file inputs
- `--change <slug>`: explicit change id (kebab-case)
- `--json`: structured output

#### Scenario: Plan uses repo root
- GIVEN `--dir /tmp/myrepo` is passed
- WHEN `ralphy-sdd plan "..." --dir /tmp/myrepo`
- THEN it MUST read and write all repo-relative paths under `/tmp/myrepo`

#### Scenario: Plan backend defaults match run
- GIVEN `openspec/project.yml` sets `defaults.backend: "codex"`
- WHEN `ralphy-sdd plan "..."` is executed without `--backend`
- THEN it MUST choose `"codex"` as backend

### Requirement: Reference inputs
The `plan` command MUST accept reference inputs via `--ref` and include them in the planning context pack.

#### Scenario: `--ref` is repeatable
- GIVEN `--ref reference.md --ref docs/notes.md`
- WHEN `plan` is executed
- THEN both files MUST be included in the context pack in deterministic order

#### Scenario: `--ref` supports globs
- GIVEN `--ref docs/*.md`
- WHEN `plan` is executed
- THEN it MUST expand the glob relative to repo root
- AND include all matched files (deduplicated, stable-sorted)

#### Scenario: Glob matches zero files
- GIVEN `--ref docs/does-not-exist-*.md`
- WHEN `plan` is executed
- THEN it MUST fail deterministically with exit code 4
- AND in `--json` mode it MUST include an error message indicating "no ref files matched"

### Requirement: Outputs (files)
The `plan` command MUST create/update the following outputs:

- `openspec/project.md` (project context; created if missing, not overwritten)
- `openspec/project.yml` (authoritative plan file containing tasks/validators/budgets)
- `openspec/changes/<changeId>/proposal.md`
- `openspec/changes/<changeId>/tasks.md`
- `openspec/changes/<changeId>/specs/**/spec.md` (at least one spec delta file)
- `ralphy-sdd/STATUS.md` (indicating PLAN completed)
- `ralphy-sdd/runs/<runId>.md` (plan log)

#### Scenario: Minimum change folder contents
- GIVEN `ralphy-sdd plan "..."` succeeds
- THEN `openspec/changes/<changeId>/proposal.md` MUST exist
- AND `openspec/changes/<changeId>/tasks.md` MUST exist
- AND at least one file MUST exist under `openspec/changes/<changeId>/specs/`

### Requirement: Change id derivation
If `--change` is not provided, the `plan` command MUST derive a `changeId` from the input deterministically.

#### Scenario: Explicit change id
- GIVEN `--change add-profile-filters`
- WHEN `plan` runs
- THEN it MUST use `openspec/changes/add-profile-filters/` as output folder

#### Scenario: Derived change id
- GIVEN no `--change` flag is provided
- WHEN `plan` runs
- THEN it MUST derive a kebab-case id
- AND it MUST NOT exceed 50 characters

#### Scenario: Collision handling
- GIVEN the derived `<changeId>` already exists and is non-empty
- WHEN plan runs without `--change`
- THEN the command MUST avoid clobbering by choosing a different id (e.g. suffix)

### Requirement: JSON output
When `--json` is provided, the command MUST output machine-readable JSON.

#### Scenario: JSON shape on success
- GIVEN `ralphy-sdd plan "..." --json` succeeds
- THEN stdout MUST be valid JSON
- AND include fields: `ok`, `changeId`, `runId`, `writtenFiles`, `validation`, `warnings`

#### Scenario: JSON shape on failure
- GIVEN `ralphy-sdd plan "..." --json` fails
- THEN stdout MUST be valid JSON
- AND include fields: `ok=false`, `exitCode`, and `error`

### Requirement: Post-plan validation
After generating artifacts, the `plan` command MUST validate the resulting OpenSpec plan deterministically.

#### Scenario: Schema validation
- GIVEN `plan` has written `openspec/project.yml`
- WHEN post-plan validation runs
- THEN it MUST load the spec via `SpecLoader.loadProjectSpec()`
- AND fail with a deterministic error if the schema is invalid

### Requirement: Exit codes
The `plan` command MUST use deterministic exit codes:

- `0`: success
- `4`: invalid inputs or invalid/insufficient planned outputs (structural/schema failures)
- `5`: backend invocation error
- `6`: filesystem / IO error writing outputs

#### Scenario: Invalid PRD file path
- GIVEN `ralphy-sdd plan does-not-exist.md`
- WHEN executed
- THEN it MUST exit with code `4`

### Requirement: CLI Workflow Includes Plan
The documented workflow MUST support `init → plan → run` as a first-class CLI flow.

#### Scenario: CLI help includes plan
- GIVEN `ralphy-sdd --help`
- WHEN executed
- THEN it MUST list the `plan` command

