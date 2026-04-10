/**
 * Planning pipeline — orchestrates the full `ralphy-sdd plan` flow.
 *
 * Pipeline stages:
 * 1. Resolve refs
 * 2. Derive changeId
 * 3. Build context pack
 * 4. Invoke backend (or noop)
 * 5. Validate outputs + quality gates
 * 6. Write artifacts
 */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { execa } from "execa";
import { resolveRefs, RefResolutionError } from "./refs";
import { readRefContents } from "./refs";
import { deriveChangeId } from "./change-id";
import { buildContextPack } from "./context-pack";
import type { PlanOptions } from "../../cli/plan";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type PlanResult = {
    ok: boolean;
    exitCode: number;
    changeId?: string;
    runId?: string;
    writtenFiles?: string[];
    validation?: { specLoad: boolean; scaffoldOk: boolean };
    warnings?: string[];
    error?: string;
};

// ────────────────────────────────────────────────────────────────────
// Pipeline
// ────────────────────────────────────────────────────────────────────

export async function executePlanPipeline(
    opts: PlanOptions,
    input: { text: string; source: "file" | "prompt"; file?: string },
): Promise<PlanResult> {
    const repoRoot = opts.dir;
    const warnings: string[] = [];
    const runId = generateRunId();

    // ── Stage 1: Resolve refs ──
    let resolvedRefs;
    try {
        const refResult = await resolveRefs(opts.ref, repoRoot);
        resolvedRefs = refResult.refs;
        warnings.push(...refResult.warnings);
    } catch (err) {
        if (err instanceof RefResolutionError) {
            return { ok: false, exitCode: 4, error: err.message, warnings };
        }
        throw err;
    }

    // ── Stage 2: Derive changeId ──
    const existingChanges = listExistingChanges(repoRoot);
    const changeId = opts.change ?? deriveChangeId(input.text, existingChanges);

    if (!changeId) {
        return {
            ok: false,
            exitCode: 4,
            error: "Could not derive a valid change id from the input. Use --change to specify one.",
            warnings,
        };
    }

    // ── Stage 3: Build context pack ──
    const contextPack = await buildContextPack({
        userInput: input.text,
        inputSource: input.source,
        inputFile: input.file,
        refs: resolvedRefs,
        repoRoot,
        backendId: opts.backend,
        changeId,
    });
    warnings.push(...contextPack.warnings);

    // ── Stage 4: Invoke backend ──
    const changeDir = path.join(repoRoot, "openspec", "changes", changeId);
    let backendResult;
    try {
        backendResult = await invokeBackend(opts.backend, repoRoot, contextPack.text);
    } catch (err: any) {
        return {
            ok: false,
            exitCode: 5,
            changeId,
            runId,
            error: `Backend error: ${err?.message ?? "unknown"}`,
            warnings,
        };
    }

    if (!backendResult.ok) {
        return {
            ok: false,
            exitCode: 5,
            changeId,
            runId,
            error: backendResult.message,
            warnings,
        };
    }

    // ── Stage 5: Validate outputs ──
    const writtenFiles: string[] = [];

    // Check that the backend created the expected change folder structure
    const validation = validatePlanOutputs(repoRoot, changeId);
    if (!validation.ok) {
        return {
            ok: false,
            exitCode: 4,
            changeId,
            runId,
            error: validation.error,
            validation: { specLoad: false, scaffoldOk: false },
            warnings: [...warnings, ...validation.warnings],
        };
    }
    writtenFiles.push(...validation.files);
    warnings.push(...validation.warnings);

    // ── Stage 5b: Scope guard — verify only OpenSpec paths were touched ──
    const scopeViolations = detectPlanScopeViolations(repoRoot, writtenFiles);
    if (scopeViolations.length > 0) {
        return {
            ok: false,
            exitCode: 4,
            changeId,
            runId,
            error: `Plan scope violation: ${scopeViolations.join("; ")}`,
            warnings,
        };
    }

    // ── Stage 6: Schema-level validation ──
    let specLoad = false;
    try {
        const { SpecLoader } = await import("../spec/loader");
        const loader = new SpecLoader(repoRoot);
        await loader.loadProjectSpec();
        specLoad = true;
    } catch (err: any) {
        warnings.push(`Spec validation warning: ${err?.message ?? "unknown"}`);
    }

    const scaffoldOk = checkScaffold(repoRoot);

    // ── Stage 7: Write artifacts ──
    try {
        await writePlanArtifacts(repoRoot, opts.artifactDir, {
            changeId,
            runId,
            input,
            refs: resolvedRefs.map((r) => r.relPath),
            writtenFiles,
            specLoad,
            scaffoldOk,
            warnings,
        });
        writtenFiles.push(
            path.join(opts.artifactDir ?? "ralphy-sdd", "STATUS.md"),
            path.join(opts.artifactDir ?? "ralphy-sdd", "runs", `${runId}.md`),
        );
    } catch (err: any) {
        warnings.push(`Artifact write warning: ${err?.message ?? "unknown"}`);
    }

    return {
        ok: true,
        exitCode: 0,
        changeId,
        runId,
        writtenFiles,
        validation: { specLoad, scaffoldOk },
        warnings,
    };
}

// ────────────────────────────────────────────────────────────────────
// Backend invocation
// ────────────────────────────────────────────────────────────────────

type BackendInvokeResult = { ok: boolean; message: string };

async function invokeBackend(
    backendId: string,
    cwd: string,
    prompt: string,
): Promise<BackendInvokeResult> {
    if (backendId === "noop") {
        return { ok: true, message: "Noop backend: no planning performed. Validate outputs manually." };
    }

    // Write prompt to a temp file for backends that prefer file input
    const promptFile = path.join(cwd, ".ralphy-plan-prompt.tmp.md");
    try {
        fs.writeFileSync(promptFile, prompt, "utf-8");

        const { command, args } = getBackendCommand(backendId, prompt, promptFile);

        const result = await execa(command, args, {
            cwd,
            timeout: 600_000, // 10 minute hard cap for planning
            reject: false,
            stdio: "pipe",
        });

        if (result.exitCode === 0) {
            return { ok: true, message: `${backendId} planning completed successfully` };
        }

        // Handle ENOENT inside result
        if ((result as any).code === "ENOENT") {
            return {
                ok: false,
                message: `${backendId} CLI not found. Ensure it is installed and in PATH.`,
            };
        }

        return {
            ok: false,
            message: `${backendId} exited with code ${result.exitCode}: ${(result.stderr || result.stdout || "").slice(0, 2000)}`,
        };
    } catch (err: any) {
        if (err?.code === "ENOENT") {
            return {
                ok: false,
                message: `${backendId} CLI not found. Ensure it is installed and in PATH.`,
            };
        }
        return { ok: false, message: err?.message ?? "Unknown backend error" };
    } finally {
        // Clean up temp file
        try {
            fs.unlinkSync(promptFile);
        } catch {
            // ignore
        }
    }
}

function getBackendCommand(
    backendId: string,
    prompt: string,
    _promptFile: string,
): { command: string; args: string[] } {
    switch (backendId) {
        case "codex":
            return { command: "codex", args: ["exec", prompt, "--full-auto"] };
        case "claude-code":
            return { command: "claude", args: ["--print", prompt] };
        case "opencode":
            return { command: "opencode", args: ["--prompt", prompt] };
        default:
            // Unknown backend — try to invoke it as a command with the prompt as arg
            return { command: backendId, args: [prompt] };
    }
}

// ────────────────────────────────────────────────────────────────────
// Output validation
// ────────────────────────────────────────────────────────────────────

type ValidationResult = {
    ok: boolean;
    files: string[];
    warnings: string[];
    error?: string;
};

function validatePlanOutputs(
    repoRoot: string,
    changeId: string,
): ValidationResult {
    const changeDir = path.join(repoRoot, "openspec", "changes", changeId);
    const files: string[] = [];
    const warnings: string[] = [];

    // Required files
    const required: Array<{ rel: string; label: string }> = [
        { rel: "proposal.md", label: "proposal" },
        { rel: "tasks.md", label: "tasks" },
    ];

    for (const { rel, label } of required) {
        const abs = path.join(changeDir, rel);
        if (fs.existsSync(abs)) {
            files.push(path.relative(repoRoot, abs));
        } else {
            return {
                ok: false,
                files,
                warnings,
                error: `Missing required plan output: ${label} (expected at ${path.relative(repoRoot, abs)})`,
            };
        }
    }

    // At least one spec delta
    const specsDir = path.join(changeDir, "specs");
    let hasSpec = false;
    if (fs.existsSync(specsDir)) {
        const walkSpecs = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    walkSpecs(path.join(dir, entry.name));
                } else if (entry.name.endsWith(".md")) {
                    hasSpec = true;
                    files.push(path.relative(repoRoot, path.join(dir, entry.name)));
                }
            }
        };
        walkSpecs(specsDir);
    }

    if (!hasSpec) {
        warnings.push(
            "No spec delta files found under specs/. Consider adding at least one spec.md.",
        );
    }

    // Check project.yml exists (may have been updated by backend)
    const projectYml = path.join(repoRoot, "openspec", "project.yml");
    if (fs.existsSync(projectYml)) {
        files.push("openspec/project.yml");
    }

    return { ok: true, files, warnings };
}

// ────────────────────────────────────────────────────────────────────
// Scope guard
// ────────────────────────────────────────────────────────────────────

/** Allowed path prefixes for plan outputs. */
const PLAN_ALLOWED_PREFIXES = ["openspec/", "ralphy-sdd/"];

function detectPlanScopeViolations(
    repoRoot: string,
    writtenFiles: string[],
): string[] {
    const violations: string[] = [];
    for (const rel of writtenFiles) {
        const normalized = rel.replace(/\\/g, "/");
        const isAllowed = PLAN_ALLOWED_PREFIXES.some((p) => normalized.startsWith(p));
        if (!isAllowed) {
            violations.push(`File outside plan scope: ${rel}`);
        }
    }
    return violations;
}

// ────────────────────────────────────────────────────────────────────
// Scaffold check
// ────────────────────────────────────────────────────────────────────

function checkScaffold(repoRoot: string): boolean {
    const checks = [
        path.join(repoRoot, "openspec"),
        path.join(repoRoot, "openspec", "project.md"),
        path.join(repoRoot, "openspec", "project.yml"),
    ];
    return checks.every((p) => fs.existsSync(p));
}

// ────────────────────────────────────────────────────────────────────
// Artifact writing
// ────────────────────────────────────────────────────────────────────

async function writePlanArtifacts(
    repoRoot: string,
    artifactDirOverride: string | undefined,
    ctx: {
        changeId: string;
        runId: string;
        input: { text: string; source: "file" | "prompt"; file?: string };
        refs: string[];
        writtenFiles: string[];
        specLoad: boolean;
        scaffoldOk: boolean;
        warnings: string[];
    },
): Promise<void> {
    const artifactRoot = artifactDirOverride
        ? path.resolve(artifactDirOverride)
        : path.join(repoRoot, "ralphy-sdd");
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.mkdirSync(path.join(artifactRoot, "runs"), { recursive: true });

    // STATUS.md
    const statusContent = [
        "# ralphy-sdd Status",
        "",
        `**Phase:** PLAN`,
        `**Status:** PLAN completed`,
        `**Change:** \`${ctx.changeId}\``,
        `**Run ID:** \`${ctx.runId}\``,
        `**Timestamp:** ${new Date().toISOString()}`,
        "",
        "## Written Files",
        ...ctx.writtenFiles.map((f) => `- \`${f}\``),
        "",
        "## Validation",
        `- Spec load: ${ctx.specLoad ? "✅" : "⚠️"}`,
        `- Scaffold: ${ctx.scaffoldOk ? "✅" : "⚠️"}`,
        "",
        ctx.warnings.length > 0
            ? `## Warnings\n${ctx.warnings.map((w) => `- ${w}`).join("\n")}\n`
            : "",
        "---",
        `Next step: \`ralphy-sdd run\` to implement the planned tasks.`,
        "",
    ].join("\n");
    fs.writeFileSync(path.join(artifactRoot, "STATUS.md"), statusContent, "utf-8");

    // Run log
    const runContent = [
        `# Plan Run: ${ctx.runId}`,
        "",
        `**Change:** \`${ctx.changeId}\``,
        `**Input source:** ${ctx.input.source}${ctx.input.file ? ` (${ctx.input.file})` : ""}`,
        `**Input length:** ${ctx.input.text.length} chars`,
        `**Refs:** ${ctx.refs.length > 0 ? ctx.refs.map((r) => `\`${r}\``).join(", ") : "(none)"}`,
        `**Timestamp:** ${new Date().toISOString()}`,
        "",
        "## Files Written",
        ...ctx.writtenFiles.map((f) => `- \`${f}\``),
        "",
        "## Validation",
        `- Spec load: ${ctx.specLoad ? "pass" : "fail"}`,
        `- Scaffold: ${ctx.scaffoldOk ? "pass" : "fail"}`,
        "",
        ctx.warnings.length > 0
            ? `## Warnings\n${ctx.warnings.map((w) => `- ${w}`).join("\n")}\n`
            : "",
    ].join("\n");
    fs.writeFileSync(
        path.join(artifactRoot, "runs", `${ctx.runId}.md`),
        runContent,
        "utf-8",
    );
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function generateRunId(): string {
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const rand = crypto.randomBytes(3).toString("hex");
    return `plan-${ts}-${rand}`;
}

function listExistingChanges(repoRoot: string): string[] {
    const changesDir = path.join(repoRoot, "openspec", "changes");
    if (!fs.existsSync(changesDir)) return [];
    try {
        return fs
            .readdirSync(changesDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    } catch {
        return [];
    }
}
