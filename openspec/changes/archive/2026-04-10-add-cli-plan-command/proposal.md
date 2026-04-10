# Proposal: v0.4.0 — Add `ralphy-sdd plan` (CLI-driven OpenSpec planning)

**Type:** Feature / Workflow enhancement  
**Depends on:** `ralphy-sdd v2.1` (budgets, sprint semantics, artifacts)  

## Summary

Add a new CLI command `ralphy-sdd plan <input>` (string prompt or PRD file) so users can bootstrap OpenSpec changes and tasks from the terminal without needing Codex/Claude Code interactive commands.

This command generates the same planning artifacts promised by `/ralphy-plan`, but does so via the existing backend adapter layer and artifact system.

## Motivation

### Problem
Today, "Plan" is effectively tied to IDE-specific flows (Codex prompts / Claude Code commands), which creates friction for:
- CLI-first users
- Headless automation
- Quick "PRD → OpenSpec change folder" bootstrapping

### Goal
Make "Plan" a first-class CLI stage, aligning with the existing workflow: **Plan → Implement → Validate → Archive**.

## Scope

- `ralphy-sdd plan <input|file>` supporting:
  - `ralphy-sdd plan "I want to build a website for my xxx"` (inline prompt)
  - `ralphy-sdd plan prd.md` (PRD file)
  - `ralphy-sdd plan "..." --ref reference.md --ref docs/notes.md` (with references)
  - `ralphy-sdd plan prd.md --ref docs/*.md` (with glob references)
- Required flags: `--dir`, `--backend`, `--artifact-dir`, `--ref` (repeatable), `--change`, `--json`
- Planning "mode" constraints:
  - Planner MUST only write OpenSpec files and artifacts (no product code changes)
  - Planner MUST produce tasks with sprint sizing, three-tier budgets, file contracts, validators, and per-task acceptance
- Post-plan validation (OpenSpec scaffold sanity + project.yml schema load)
- Reuse existing prompt templates and backend adapter layer (no new infrastructure)

## Non-Goals

- Implementing the planned tasks (that remains `ralphy-sdd run`)
- Changing the on-disk schema beyond what `openspec/project.yml` already supports
- Adding an interactive PRD editor or UI
- Auto-splitting "XL tasks" (future follow-up)
- Multi-agent orchestration / parallel task execution
- Remote backends or hosted planning service

## Approach (No New Infrastructure)

1. Reuse existing prompt templates installed by `init`
2. Assemble a **Planning Context Pack** from user input, refs, repo context, and PLAN MODE constraints
3. Invoke the chosen backend via existing backend adapter layer
4. Validate and write outputs
5. Write artifacts marking PLAN completion

## Risks / Mitigations

| Risk | Mitigation |
|------|-----------|
| Backend CLI variability | Keep adapter behavior minimal, clear errors, support `noop` for testing |
| Overwriting user content | Additive by default, refuse to overwrite non-empty change folders |
| Change slug collisions | Derive stable kebab-case slug with short suffix when needed |
| Prompt injection via refs | Treat refs as untrusted, constrain planning prompt outputs |
| Context bloat from refs | Bound context pack by count and/or bytes |

## Success Criteria

- `ralphy-sdd init → plan → run` works entirely from CLI
- `plan` produces schema-valid `openspec/project.yml` tasks with sprint sizing, budgets, file contracts, validators, and acceptance
- `plan` writes artifacts marking PLAN completion
- `--json` output is machine-readable
- Post-plan validation prevents unusable project specs
