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
        backendResult = await invokeBackend(opts.backend, repoRoot, contextPack.text, opts.json);
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
    jsonMode: boolean = false,
): Promise<BackendInvokeResult> {
    if (backendId === "noop") {
        return { ok: true, message: "Noop backend: no planning performed. Validate outputs manually." };
    }

    // Write prompt to a temp file (kept for diagnostics)
    const promptFile = path.join(cwd, ".ralphy-plan-prompt.tmp.md");
    try {
        fs.writeFileSync(promptFile, prompt, "utf-8");

        const { command, args, useJsonStream, stdinPrompt } = getBackendCommand(backendId, prompt);

        if (useJsonStream && !jsonMode) {
            // Use JSONL event stream to show filtered progress
            return await invokeWithProgress(command, args, cwd, stdinPrompt);
        }

        // Fallback: pipe mode (for --json) or inherit (non-codex backends)
        const result = await execa(command, args, {
            cwd,
            timeout: 600_000,
            reject: false,
            ...(stdinPrompt ? { input: stdinPrompt } : {}),
            stdio: stdinPrompt
                ? ["pipe", jsonMode ? "pipe" : "inherit", jsonMode ? "pipe" : "inherit"]
                : jsonMode ? "pipe" : ["ignore", "inherit", "inherit"],
        });

        if (result.exitCode === 0) {
            return { ok: true, message: `${backendId} planning completed successfully` };
        }

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
        try {
            fs.unlinkSync(promptFile);
        } catch {
            // ignore
        }
    }
}

/**
 * Invoke a backend with JSONL event streaming, filtering output to show
 * only key progress events (tool calls, file writes, thinking, etc.)
 */
async function invokeWithProgress(
    command: string,
    args: string[],
    cwd: string,
    stdinPrompt?: string,
): Promise<BackendInvokeResult> {
    const startTime = Date.now();
    let lastActivity = "";
    let toolCallCount = 0;
    let fileWriteCount = 0;

    const write = (msg: string) => process.stderr.write(msg);

    write("\u23F3 Planning started...\n");

    const child = execa(command, args, {
        cwd,
        timeout: 600_000,
        reject: false,
        stdio: ["pipe", "pipe", "pipe"],
    });

    // Send prompt via stdin and close it immediately
    if (stdinPrompt && child.stdin) {
        child.stdin.write(stdinPrompt);
        child.stdin.end();
    } else if (child.stdin) {
        child.stdin.end();
    }

    // Parse JSONL events from stdout
    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const event = JSON.parse(line);
                handleProgressEvent(event, write, startTime, {
                    getToolCallCount: () => toolCallCount,
                    incToolCallCount: () => { toolCallCount++; },
                    getFileWriteCount: () => fileWriteCount,
                    incFileWriteCount: () => { fileWriteCount++; },
                    getLastActivity: () => lastActivity,
                    setLastActivity: (a: string) => { lastActivity = a; },
                });
            } catch {
                // Not valid JSON, skip
            }
        }
    });

    // Filter stderr — suppress known informational messages
    child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (!text) return;
        // Suppress known codex info messages
        if (text.includes("Reading prompt from stdin") || text.includes("Reading additional input")) return;
        write(`  \u26A0 ${text.slice(0, 200)}\n`);
    });

    const result = await child;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (result.exitCode === 0) {
        write(`\u2705 Backend completed in ${elapsed}s (${toolCallCount} tool calls, ${fileWriteCount} file writes)\n`);
        return { ok: true, message: `Planning completed in ${elapsed}s` };
    }

    write(`\u274C Backend failed (exit ${result.exitCode}) after ${elapsed}s\n`);
    return {
        ok: false,
        message: `Backend exited with code ${result.exitCode} after ${elapsed}s`,
    };
}

type ProgressCtx = {
    getToolCallCount: () => number;
    incToolCallCount: () => void;
    getFileWriteCount: () => number;
    incFileWriteCount: () => void;
    getLastActivity: () => string;
    setLastActivity: (a: string) => void;
};

/**
 * Handle codex JSONL events.
 *
 * Codex event format:
 *   { type: "thread.started", thread_id: "..." }
 *   { type: "turn.started" }
 *   { type: "item.started", item: { id, type, ... } }
 *   { type: "item.completed", item: { id, type, text?, changes?, command?, status? } }
 *   { type: "turn.completed", usage: { input_tokens, output_tokens, ... } }
 */
function handleProgressEvent(
    event: any,
    write: (msg: string) => void,
    startTime: number,
    ctx: ProgressCtx,
): void {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const type = event.type ?? "";

    if (type === "turn.started") {
        write(`  \uD83D\uDCCB [${elapsed}s] Processing...\n`);

    } else if (type === "item.started") {
        const item = event.item ?? {};
        if (item.type === "function_call" || item.type === "tool_call") {
            ctx.incToolCallCount();
            const name = item.name ?? item.function ?? "tool";
            const args = item.arguments ?? {};
            const summary = summarizeItem(name, args);
            write(`  \uD83D\uDD27 [${elapsed}s] ${name}${summary ? `: ${summary}` : ""}\n`);
        } else if (item.type === "file_change") {
            const changes = item.changes ?? [];
            for (const c of changes) {
                ctx.incFileWriteCount();
                const kind = c.kind ?? "change";
                const filePath = c.path ?? "";
                write(`  \uD83D\uDCDD [${elapsed}s] ${kind}: ${filePath}\n`);
            }
        } else if (item.type === "exec" || item.type === "shell") {
            ctx.incToolCallCount();
            const cmd = item.command ?? item.cmd ?? "";
            const shortCmd = cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
            write(`  \uD83D\uDCBB [${elapsed}s] exec: ${shortCmd}\n`);
        }

    } else if (type === "item.completed") {
        const item = event.item ?? {};
        if (item.type === "agent_message" && item.text) {
            // Show agent's thinking/summary (truncated)
            const text = item.text.length > 120 ? item.text.slice(0, 117) + "..." : item.text;
            write(`  \uD83D\uDCA1 [${elapsed}s] ${text}\n`);
        } else if (item.type === "file_change" && item.status === "completed") {
            const changes = item.changes ?? [];
            for (const c of changes) {
                if (ctx.getLastActivity() !== c.path) {
                    ctx.incFileWriteCount();
                    write(`  \u2705 [${elapsed}s] ${c.kind ?? "wrote"}: ${c.path ?? ""}\n`);
                    ctx.setLastActivity(c.path ?? "");
                }
            }
        } else if (item.type === "function_call" || item.type === "tool_call") {
            // Tool call completed — already shown at item.started
        }

    } else if (type === "turn.completed") {
        const usage = event.usage ?? {};
        const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
        write(`  \uD83D\uDCCA [${elapsed}s] Turn done (${tokens.toLocaleString()} tokens)\n`);
    }
}

function summarizeItem(name: string, args: any): string {
    if (typeof args === "string") return args.slice(0, 60);
    const path = args?.path ?? args?.file ?? args?.command ?? "";
    if (typeof path === "string") {
        return path.length > 60 ? path.slice(0, 57) + "..." : path;
    }
    return "";
}

function getBackendCommand(
    backendId: string,
    prompt: string,
): { command: string; args: string[]; useJsonStream: boolean; stdinPrompt?: string } {
    switch (backendId) {
        case "codex":
            // Pass prompt via stdin (codex reads from stdin when no prompt arg given)
            // This avoids ARG_MAX limits and the "Reading from stdin" hang
            return {
                command: "codex",
                args: ["exec", "--full-auto", "--json"],
                useJsonStream: true,
                stdinPrompt: prompt,
            };
        case "claude-code":
            return {
                command: "claude",
                args: ["--print", prompt],
                useJsonStream: false,
            };
        case "opencode":
            return {
                command: "opencode",
                args: ["--prompt", prompt],
                useJsonStream: false,
            };
        default:
            return {
                command: backendId,
                args: [prompt],
                useJsonStream: false,
            };
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
