# Tasks: integrate-openspec-cli

**Change:** `integrate-openspec-cli`

---

## 1. Core Bridge Layer

- [ ] 1.1 Create `src/core/openspec/bridge.ts` with `OpenSpecBridge` class
  - Implementation notes:
    - Detect CLI via `execa("openspec", ["--version"])` wrapped in try/catch
    - Parse semver output, require >= 1.0.0
    - Cache detection result as singleton (lazy, first-call initialization)
    - Provide `exec(args: string[], opts?: { timeout?: number; cwd?: string; json?: boolean })` method
    - Default timeout: 30_000ms
    - When `json: true`, parse stdout as JSON; on parse failure, throw with raw output
  - Acceptance criteria:
    - GIVEN openspec CLI is installed globally
    - WHEN `OpenSpecBridge.isAvailable()` is called
    - THEN it returns `true` and caches the result
    - GIVEN openspec CLI is NOT installed
    - WHEN `OpenSpecBridge.isAvailable()` is called
    - THEN it returns `false` without throwing
  - Test plan:
    - `npm run typecheck`
    - Unit test: mock execa to simulate available/unavailable/timeout scenarios

- [ ] 1.2 Create `src/core/openspec/types.ts` with shared bridge types
  - Implementation notes:
    - Define `OpenSpecValidationReport`, `OpenSpecChange`, `OpenSpecInstruction` types
    - Map from official CLI JSON output shapes
    - Use zod schemas for defensive parsing of CLI output
  - Test plan:
    - `npm run typecheck`

- [ ] 1.3 Create `src/core/openspec/index.ts` barrel export
  - Implementation notes:
    - Re-export bridge class and types
    - Export a default singleton: `export const openspec = new OpenSpecBridge()`
  - Test plan:
    - `npm run typecheck`

## 2. Init Bridge

- [ ] 2.1 Add `initScaffold()` method to `OpenSpecBridge`
  - Implementation notes:
    - When available: call `openspec init <path> --tools <tools>`
    - Map ralphy-sdd tool ids (cursor, opencode, claude-code) to openspec tool names
    - When unavailable: return `{ bridged: false }` so caller uses fallback
  - Acceptance criteria:
    - GIVEN openspec CLI is available
    - WHEN `bridge.initScaffold(path, { tools: ["cursor"] })` is called
    - THEN `openspec init <path> --tools cursor` is executed
  - Test plan:
    - `npm run typecheck`

- [ ] 2.2 Modify `src/utils/installer.ts` to use bridge with fallback
  - Implementation notes:
    - Import `openspec` singleton from bridge
    - In `ensureOpenSpecScaffold()`: check `openspec.isAvailable()`, if true delegate; if false use existing logic
    - Log which path was taken (bridge vs fallback) at info level
  - Acceptance criteria:
    - GIVEN openspec CLI is NOT installed
    - WHEN `ralphy-sdd init` is run
    - THEN existing scaffold creation logic runs without error
  - Test plan:
    - `npm run typecheck`
    - `npm test`

## 3. Validate Bridge

- [ ] 3.1 Add `validate()` method to `OpenSpecBridge`
  - Implementation notes:
    - Call `openspec validate --all --json`
    - Parse `ValidationReport` JSON output
    - Map `ValidationIssue` (level: ERROR/WARNING/INFO) to ralphy-sdd format (level: error/warning)
  - Acceptance criteria:
    - GIVEN openspec CLI is available and a change has spec issues
    - WHEN `bridge.validate()` is called
    - THEN issues are returned in `ValidationIssue[]` format with correct levels
  - Test plan:
    - `npm run typecheck`

- [ ] 3.2 Modify `src/utils/validator.ts` to use bridge with fallback
  - Implementation notes:
    - In `validateProject()`: if bridge available, merge CLI validation results with existing directory checks
    - Keep existing directory/file checks as baseline (they check things the CLI doesn't)
    - Append CLI validation issues (delta spec checks) when available
  - Acceptance criteria:
    - GIVEN openspec CLI is installed
    - WHEN `ralphy-sdd validate` is run on a project with spec issues
    - THEN delta spec issues (e.g., missing SHALL/MUST) appear in output
  - Test plan:
    - `npm run typecheck`
    - `npm test`

## 4. Archive Bridge

- [ ] 4.1 Create `src/core/openspec/archive.ts` with `archiveChange()` function
  - Implementation notes:
    - When available: call `openspec archive <name> --yes`; support `--skip-specs` option
    - When unavailable: return `{ bridged: false, instructions: "..." }` with manual steps
  - Acceptance criteria:
    - GIVEN openspec CLI is available and a change exists
    - WHEN `archiveChange("my-change")` is called
    - THEN `openspec archive my-change --yes` is executed
  - Test plan:
    - `npm run typecheck`

## 5. Change & Instructions Bridge

- [ ] 5.1 Create `src/core/openspec/change.ts` with change management functions
  - Implementation notes:
    - `createChange(name: string)`: wraps `openspec new change <name>`
    - `getInstructions(artifact: string, changeName: string)`: wraps `openspec instructions <artifact> --change <name> --json`
    - Both return `{ bridged: false }` when CLI unavailable
  - Acceptance criteria:
    - GIVEN openspec CLI is available
    - WHEN `getInstructions("proposal", "my-feature")` is called
    - THEN parsed instruction JSON (template, instruction text, dependencies) is returned
  - Test plan:
    - `npm run typecheck`

## 6. Query Bridge

- [ ] 6.1 Create `src/core/openspec/query.ts` with listing and status functions
  - Implementation notes:
    - `listChanges()`: wraps `openspec list --json`
    - `getChangeStatus(changeName: string)`: wraps `openspec status --change <name> --json`
    - Both return `{ bridged: false }` when CLI unavailable
  - Acceptance criteria:
    - GIVEN openspec CLI is available and changes exist
    - WHEN `listChanges()` is called
    - THEN parsed change list (name, completedTasks, totalTasks, status) is returned
  - Test plan:
    - `npm run typecheck`

## 7. CLI Integration

- [ ] 7.1 Update `src/cli/init.ts` to pass OpenSpec-specific options
  - Implementation notes:
    - Add `--no-openspec` flag to force built-in scaffold (skip bridge)
    - Pass `--tools` and `--force` through to bridge when applicable
  - Test plan:
    - `npm run typecheck`

- [ ] 7.2 Update `src/cli/validate.ts` to show enriched validation
  - Implementation notes:
    - When bridge is used, display additional "OpenSpec CLI validation" section in output
    - Add `--no-openspec` flag to skip CLI validation
  - Test plan:
    - `npm run typecheck`

## 8. Configuration

- [ ] 8.1 Create `openspec/config.yaml` for this project
  - Implementation notes:
    - Set `schema: spec-driven` and `context: openspec/project.md`
    - This enables `openspec instructions` and `openspec status` to work correctly
  - Test plan:
    - `openspec validate --all`

## 9. Tests

- [ ] 9.1 Add unit tests for `OpenSpecBridge`
  - Implementation notes:
    - Test file: `src/core/openspec/bridge.test.ts`
    - Mock `execa` to simulate: CLI available, CLI missing, timeout, JSON parse error
    - Test version parsing: "1.0.0" → ok, "0.9.0" → too old, "abc" → invalid
    - Test `exec()` with JSON and non-JSON modes
  - Test plan:
    - `npm test`

---

## Validation Checklist (manual)

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] With openspec CLI installed: `ralphy-sdd init` uses bridge
- [ ] Without openspec CLI: `ralphy-sdd init` uses fallback
- [ ] `openspec validate --all --json` matches ralphy-sdd validate output
