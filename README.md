# ralphy-sdd

[English](README.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

**Spec-driven AI development with iterative execution.** Combines OpenSpec + Ralph Loop for predictable AI-assisted coding.

**Website:** [https://ralphy-sdd.org](https://ralphy-sdd.org)
**Docs:** [https://ralphy-sdd.org/en/docs/](https://ralphy-sdd.org/en/docs/)
**Changelog:** [https://ralphy-sdd.org/en/changelog/](https://ralphy-sdd.org/en/changelog/) · [GitHub](https://github.com/kingtao/ralphy-sdd/blob/main/CHANGELOG.md)

## Quick Start

```bash
npx ralphy-sdd init
```

CLI basics:

```bash
ralphy-sdd run --dry-run
ralphy-sdd run
ralphy-sdd status
ralphy-sdd budget --json
```

Logs & artifacts (during/after runs):
- `ralphy-sdd/STATUS.md`: live status (primary)
- `ralphy-sdd/runs/<runId>.md`: run log (immutable on completion)
- `ralphy-sdd/logs/<runId>/...`: backend transcripts (stdout/stderr + metadata)

Then use the commands for your AI tool:

### Codex

| Command | What it does |
|---------|--------------|
| `/ralphy-plan` | Create specs from requirements |
| `/ralphy-implement` | Build with iterative loop |
| `/ralphy-validate` | Verify acceptance criteria |
| `/ralphy-archive` | Complete and archive |

If you want to run the full workflow from a terminal with Codex as the backend (no IDE slash commands), you must authenticate Codex Agent first:

```bash
codex agent login

ralphy-sdd run --backend codex
# backend output streams by default; add --no-stream-backend to silence
```

### Claude Code

| Command | What it does |
|---------|--------------|
| `/ralphy-plan` | Create specs from requirements |
| `/ralphy-implement` | Build with iterative loop |
| `/ralphy-validate` | Verify acceptance criteria |
| `/ralphy-archive` | Complete and archive |

### OpenCode

Use natural language with AGENTS.md:
- `"Follow AGENTS.md to plan [feature]"`
- `"Follow AGENTS.md to implement [change]"`
- `"Follow AGENTS.md to validate"`
- `"Follow AGENTS.md to archive [change]"`

**With Ralph Loop Runner:**
```bash
npm install -g @th0rgal/ralph-wiggum
ralph "Follow AGENTS.md to implement add-api. Output <promise>TASK_COMPLETE</promise> when done." --max-iterations 20
```

## Example Workflow

```bash
# 1. Plan: Create spec from your idea
You: /ralphy-plan Add user authentication with JWT

# 2. Implement: AI builds it iteratively  
You: /ralphy-implement add-user-auth

# 3. Validate: Verify tests pass
You: /ralphy-validate

# 4. Archive: Complete the change
You: /ralphy-archive add-user-auth
```

## What Gets Created

```
.codex/prompts/          # or .claude/commands/
├── ralphy-plan.md
├── ralphy-implement.md
├── ralphy-validate.md
└── ralphy-archive.md

AGENTS.md                 # For OpenCode

openspec/
├── specs/                # Source of truth
├── changes/              # Active work  
├── archive/              # Completed
└── project.md            # Context

ralphy-sdd/              # Local state + artifacts (IDE-friendly)
├── state.db              # SQLite run/task ledger
├── STATUS.md             # Live run snapshot (primary for `ralphy-sdd status`)
├── TASKS.md              # Task board view
├── BUDGET.md             # Spend/budget breakdown
├── runs/                 # Immutable run logs (`runs/<runId>.md`)
├── logs/                 # Raw backend outputs (best-effort)
├── worktrees/            # Git worktrees per task (when enabled)
└── tasks/                # Per-task artifacts (CONTEXT / REPAIR / NOTES)
    └── <taskId>/
        ├── CONTEXT.md
        ├── REPAIR.md
        └── NOTES.md
```

> Note: Legacy `.ralphy/` folders are migrated to `ralphy-sdd/` automatically when found.

## How It Works

**Ralph Wiggum Loop:** AI receives the same prompt repeatedly until task completion. Each iteration, it sees previous work in files and self-corrects.

**OpenSpec:** Specs before code. Structured specifications with acceptance criteria ensure AI knows exactly what to build.

**The Combination:**

| Problem | Solution |
|---------|----------|
| Vague requirements in chat | Specs lock intent |
| AI stops mid-task | Loop retries until done |
| No way to verify | Tests validate output |
| Tool-specific setup | One command for all |

## Installation Options

```bash
# npx (recommended)
npx ralphy-sdd init

# Global install
npm install -g ralphy-sdd
ralphy-sdd init

# With specific tools
ralphy-sdd init --tools codex,claude-code,opencode
```

## Credits

Built on the work of:

- **[Ralph Methodology](https://ghuntley.com/ralph)** by Geoffrey Huntley
- **[opencode-ralph-wiggum](https://github.com/Th0rgal/opencode-ralph-wiggum)** by @Th0rgal  
- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** by Fission-AI

## License

BSD-3-Clause
