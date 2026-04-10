# openspec-bridge Specification

## Purpose
TBD - created by archiving change integrate-openspec-cli. Update Purpose after archive.
## Requirements
### Requirement: CLI Detection
The bridge SHALL detect whether the `openspec` CLI is installed and available on the system PATH. Detection MUST include a version check ensuring `>= 1.0.0`. The detection result SHALL be cached for the lifetime of the process.

#### Scenario: CLI is installed and version is compatible
- **WHEN** `openspec --version` returns a version >= 1.0.0
- **THEN** `isAvailable()` returns `true`
- **AND** all bridge methods delegate to the CLI

#### Scenario: CLI is not installed
- **WHEN** `openspec` is not found on PATH
- **THEN** `isAvailable()` returns `false`
- **AND** a single info-level log message suggests installing `@fission-ai/openspec`

#### Scenario: CLI version is too old
- **WHEN** `openspec --version` returns a version < 1.0.0
- **THEN** `isAvailable()` returns `false`
- **AND** a warning log message indicates the minimum required version

### Requirement: Command Execution Wrapper
The bridge SHALL provide a generic `exec(args, options?)` method that invokes `openspec` with the given arguments via `execa`. The method MUST apply a configurable timeout (default 30 seconds). If the command produces JSON output (when `--json` is in args), the method SHALL parse and return the parsed object.

#### Scenario: Successful JSON command
- **WHEN** `exec(["list", "--json"])` is called and CLI is available
- **THEN** the method returns parsed JSON from stdout

#### Scenario: Command timeout
- **WHEN** the CLI command does not complete within the configured timeout
- **THEN** the method throws a timeout error with the command details

#### Scenario: Command failure
- **WHEN** the CLI exits with non-zero code
- **THEN** the method throws an error including exit code and stderr content

### Requirement: Init Bridge
The bridge SHALL wrap `openspec init` to create the OpenSpec directory scaffold. When the CLI is available, `ralphy-sdd init` MUST delegate scaffold creation to `openspec init` with appropriate `--tools` argument. When the CLI is unavailable, the existing built-in scaffold creation logic MUST be used as fallback.

#### Scenario: Init with CLI available
- **WHEN** `ralphy-sdd init` is run and openspec CLI is detected
- **THEN** `openspec init` is invoked with matching `--tools` parameter
- **AND** the standard `openspec/` directory structure is created

#### Scenario: Init fallback without CLI
- **WHEN** `ralphy-sdd init` is run and openspec CLI is NOT detected
- **THEN** the built-in `ensureOpenSpecScaffold()` logic creates the directory structure
- **AND** a log message informs the user that built-in scaffold was used

### Requirement: Validate Bridge
The bridge SHALL wrap `openspec validate` to provide richer validation. When the CLI is available, validation MUST include delta spec semantic checks (requirement/scenario structure, SHALL/MUST enforcement). The official `ValidationReport` format SHALL be mapped to ralphy-sdd's `ValidationIssue` format.

#### Scenario: Validate with CLI available
- **WHEN** `ralphy-sdd validate` is run and openspec CLI is detected
- **THEN** `openspec validate --all --json` is invoked
- **AND** results are mapped to `ValidationIssue[]` format

#### Scenario: Validate fallback without CLI
- **WHEN** `ralphy-sdd validate` is run and openspec CLI is NOT detected
- **THEN** the built-in directory existence checks are used
- **AND** results are returned in the same `ValidationIssue[]` format

### Requirement: Archive Bridge
The bridge SHALL wrap `openspec archive <change-name> --yes` to perform validated archiving with spec-apply. The `--skip-specs` option MUST be supported for infrastructure or tooling-only changes.

#### Scenario: Archive with CLI available
- **WHEN** `archiveChange("my-change")` is called and openspec CLI is detected
- **THEN** `openspec archive my-change --yes` is invoked
- **AND** delta specs are applied to `openspec/specs/` and the change is moved to `openspec/archive/`

#### Scenario: Archive fallback without CLI
- **WHEN** `archiveChange("my-change")` is called and openspec CLI is NOT detected
- **THEN** the bridge returns a result indicating manual archive is needed
- **AND** provides instructions for manual archive steps

### Requirement: Change and Instructions Bridge
The bridge SHALL wrap `openspec new change <name>` and `openspec instructions <artifact> --change <id> --json`. These methods provide the foundation for the future `ralphy-sdd plan` command.

#### Scenario: Create new change
- **WHEN** `createChange("my-feature")` is called and CLI is available
- **THEN** `openspec new change my-feature` is invoked
- **AND** the change directory is created under `openspec/changes/my-feature/`

#### Scenario: Get enriched instructions
- **WHEN** `getInstructions("proposal", "my-feature")` is called and CLI is available
- **THEN** `openspec instructions proposal --change my-feature --json` is invoked
- **AND** the parsed instruction object (with template, instruction text, dependencies) is returned

### Requirement: Query Bridge
The bridge SHALL wrap `openspec list --json` and `openspec status --change <id> --json` to provide change/spec listing and completion tracking information.

#### Scenario: List changes
- **WHEN** `listChanges()` is called and CLI is available
- **THEN** `openspec list --json` is invoked
- **AND** the parsed change list (name, status, task counts) is returned

#### Scenario: Get change status
- **WHEN** `getChangeStatus("my-feature")` is called and CLI is available
- **THEN** `openspec status --change my-feature --json` is invoked
- **AND** artifact completion status is returned

### Requirement: Graceful Degradation
ALL bridge methods MUST implement graceful degradation. When the openspec CLI is unavailable, each method SHALL either fallback to built-in logic or return a result indicating the operation requires manual intervention. No bridge method SHALL throw an unrecoverable error due to CLI absence.

#### Scenario: All bridge methods handle missing CLI
- **WHEN** openspec CLI is not installed
- **THEN** every bridge method either uses a fallback or returns a descriptive "not available" result
- **AND** no exceptions propagate to the user

#### Scenario: Partial failure during bridged operation
- **WHEN** a CLI command fails mid-operation
- **THEN** the error is caught, logged to the ledger, and a structured error result is returned
- **AND** the system state remains consistent

