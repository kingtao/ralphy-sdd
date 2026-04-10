/**
 * Planning Context Pack builder for `ralphy-sdd plan`.
 *
 * Assembles a deterministic, bounded text payload to send to the planning
 * backend. The context pack includes:
 * - Planning template (from installed tool prompts or built-in fallback)
 * - User input (prompt or PRD content)
 * - Reference file contents
 * - Project context (openspec/project.md)
 * - Existing spec summaries (openspec/specs/**)
 * - PLAN MODE constraints
 */
import path from "node:path";
import fs from "node:fs";
import fg from "fast-glob";
import type { ResolvedRef } from "./refs";
import { readRefContents } from "./refs";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type ContextPackInput = {
    /** The resolved user input text (prompt or PRD contents). */
    userInput: string;
    /** Source type of the input. */
    inputSource: "prompt" | "file";
    /** Original file path if inputSource is "file". */
    inputFile?: string;
    /** Resolved reference files. */
    refs: ResolvedRef[];
    /** Absolute path to the repo root. */
    repoRoot: string;
    /** Backend id (used to pick the right template). */
    backendId: string;
    /** The change id to use in the planning output. */
    changeId: string;
};

export type ContextPack = {
    /** The full text payload for the backend. */
    text: string;
    /** Sections included (for diagnostics / run log). */
    sections: string[];
    /** Warnings generated during assembly. */
    warnings: string[];
};

// ────────────────────────────────────────────────────────────────────
// Template resolution
// ────────────────────────────────────────────────────────────────────

/** Known planning template locations per backend. */
const TEMPLATE_PATHS: Record<string, string[]> = {
    codex: [".codex/prompts/ralphy-plan.md"],
    "claude-code": [".claude/commands/ralphy-plan.md"],
    opencode: ["AGENTS.md"],
};

/** Built-in fallback planning template. */
const FALLBACK_TEMPLATE = `# PLAN MODE — OpenSpec Change Generation

You are an AI coding assistant in PLAN MODE.

## Your Goal
Convert the user's requirements into an OpenSpec change proposal with clear, testable tasks.

## Deliverables (create/modify files)
Create a new change folder:
- \`openspec/changes/{{changeId}}/proposal.md\`
- \`openspec/changes/{{changeId}}/tasks.md\`
- \`openspec/changes/{{changeId}}/specs/<domain>/spec.md\` (at least one)

Update the project plan:
- \`openspec/project.yml\` — add planned tasks with sprint sizing, budgets, validators, file contracts, and acceptance criteria

## Rules
- Use MUST/SHALL language for requirements
- Every Requirement MUST include at least one Scenario
- Include acceptance criteria that can be validated by tests or deterministic commands
- Keep scope explicit; list non-goals
- Each task MUST include: sprint.size, sprint.intent, validators, files_contract.allowed, acceptance

## PLAN MODE Constraints (CRITICAL)
- You MUST ONLY create or modify files under \`openspec/\` and \`ralphy-sdd/\`
- You MUST NOT create, modify, or delete any product source code (e.g. \`src/\`, \`lib/\`, \`test/\`)
- You MUST NOT run build or test commands
- If you are unsure whether a path is allowed, do NOT write to it

## Procedure
1. Read the project context and existing specs provided below
2. Analyze the user's requirements
3. Create the change folder with proposal.md, tasks.md, and spec deltas
4. Update openspec/project.yml with planned tasks
5. Summarize what was created
`;

/**
 * Attempt to load a planning template from the repo.
 * Returns the template content or null if not found.
 */
function loadInstalledTemplate(
    repoRoot: string,
    backendId: string,
): string | null {
    const candidates = TEMPLATE_PATHS[backendId] ?? [];
    for (const rel of candidates) {
        const abs = path.join(repoRoot, rel);
        if (fs.existsSync(abs)) {
            const content = fs.readFileSync(abs, "utf-8");
            // For AGENTS.md, we only want to extract it if it contains planning context
            // For dedicated plan templates, return directly
            if (rel.includes("plan")) {
                return content;
            }
            // For AGENTS.md, wrap it as supplementary context
            return content;
        }
    }
    return null;
}

// ────────────────────────────────────────────────────────────────────
// Project context loading
// ────────────────────────────────────────────────────────────────────

/**
 * Read openspec/project.md if it exists.
 */
function loadProjectContext(repoRoot: string): string | null {
    const p = path.join(repoRoot, "openspec", "project.md");
    if (fs.existsSync(p)) {
        return fs.readFileSync(p, "utf-8");
    }
    return null;
}

/**
 * Gather a brief summary of existing specs under openspec/specs/.
 * Returns a compact listing (file path + first heading) to keep context bounded.
 */
async function loadSpecsSummary(repoRoot: string): Promise<string | null> {
    const specsDir = path.join(repoRoot, "openspec", "specs");
    if (!fs.existsSync(specsDir)) return null;

    const specFiles = await fg("**/spec.md", {
        cwd: specsDir,
        absolute: false,
        onlyFiles: true,
    });

    if (specFiles.length === 0) return null;

    specFiles.sort();
    const summaries: string[] = [];

    for (const rel of specFiles) {
        const abs = path.join(specsDir, rel);
        const content = fs.readFileSync(abs, "utf-8");
        // Extract first heading as summary
        const firstHeading = content.match(/^#+\s+(.+)$/m);
        const title = firstHeading ? firstHeading[1] : "(no heading)";
        summaries.push(`- \`openspec/specs/${rel}\`: ${title}`);
    }

    return summaries.join("\n");
}

// ────────────────────────────────────────────────────────────────────
// PLAN MODE constraint block
// ────────────────────────────────────────────────────────────────────

const PLAN_MODE_CONSTRAINTS = `
## ⚠️ PLAN MODE — Scope Restrictions

You are in PLAN MODE. The following restrictions are MANDATORY:

1. **ALLOWED** writes:
   - \`openspec/changes/<changeId>/**\`
   - \`openspec/project.yml\`
   - \`openspec/project.md\` (create only if missing)
   - \`ralphy-sdd/**\` (artifact files only)

2. **FORBIDDEN** writes:
   - Any file under \`src/\`, \`lib/\`, \`test/\`, \`dist/\`, \`docs/\` or any other product code directory
   - \`package.json\`, \`tsconfig.json\`, or any config files outside openspec/

3. **FORBIDDEN** actions:
   - Running build, test, or lint commands
   - Installing dependencies
   - Modifying git history

Violating these restrictions will cause the plan to fail.
`.trim();

// ────────────────────────────────────────────────────────────────────
// Builder
// ────────────────────────────────────────────────────────────────────

/**
 * Build a deterministic planning context pack.
 *
 * The output text is structured in well-defined sections, each separated
 * by section headers. The format is stable: identical inputs always produce
 * identical output.
 */
export async function buildContextPack(
    input: ContextPackInput,
): Promise<ContextPack> {
    const sections: string[] = [];
    const warnings: string[] = [];
    const parts: string[] = [];

    // ── Section 1: Planning Template ──
    const template = loadInstalledTemplate(input.repoRoot, input.backendId);
    if (template) {
        const expanded = template.replace(/\{\{changeId\}\}/g, input.changeId);
        parts.push(`<!-- SECTION: planning-template -->\n${expanded}`);
        sections.push("planning-template");
    } else {
        const expanded = FALLBACK_TEMPLATE.replace(/\{\{changeId\}\}/g, input.changeId);
        parts.push(`<!-- SECTION: planning-template (fallback) -->\n${expanded}`);
        sections.push("planning-template (fallback)");
    }

    // ── Section 2: PLAN MODE Constraints ──
    // Always include, even if the template already mentions it
    parts.push(`<!-- SECTION: plan-mode-constraints -->\n${PLAN_MODE_CONSTRAINTS}`);
    sections.push("plan-mode-constraints");

    // ── Section 3: User Input ──
    const inputHeader =
        input.inputSource === "file"
            ? `## User Input (from file: ${input.inputFile ?? "unknown"})`
            : `## User Input (prompt)`;
    parts.push(`<!-- SECTION: user-input -->\n${inputHeader}\n\n${input.userInput}`);
    sections.push("user-input");

    // ── Section 4: Change ID ──
    parts.push(
        `<!-- SECTION: change-id -->\n## Change ID\n\nUse change id: \`${input.changeId}\`\n` +
        `Write outputs to: \`openspec/changes/${input.changeId}/\``,
    );
    sections.push("change-id");

    // ── Section 5: Project Context ──
    const projectCtx = loadProjectContext(input.repoRoot);
    if (projectCtx) {
        parts.push(`<!-- SECTION: project-context -->\n## Project Context\n\n${projectCtx}`);
        sections.push("project-context");
    }

    // ── Section 6: Existing Specs ──
    const specsSummary = await loadSpecsSummary(input.repoRoot);
    if (specsSummary) {
        parts.push(
            `<!-- SECTION: existing-specs -->\n## Existing Specs (summaries)\n\n${specsSummary}`,
        );
        sections.push("existing-specs");
    }

    // ── Section 7: Reference Files ──
    if (input.refs.length > 0) {
        const refContents = readRefContents(input.refs);
        const refParts: string[] = [];
        for (const [relPath, content] of refContents) {
            refParts.push(`### ${relPath}\n\n\`\`\`\n${content}\n\`\`\``);
        }
        parts.push(
            `<!-- SECTION: reference-files -->\n## Reference Files (${input.refs.length})\n\n${refParts.join("\n\n")}`,
        );
        sections.push("reference-files");
    }

    const text = parts.join("\n\n---\n\n");

    return { text, sections, warnings };
}
