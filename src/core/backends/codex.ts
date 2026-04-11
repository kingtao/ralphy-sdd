import { execa } from "execa";
import type { BackendEnv, CodingBackend, ImplementInput, ImplementOutput } from "./types";
import { writeBackendLog } from "./log-writer";
import { createProgressCtx, attachJsonlProgress } from "./codex-progress";

/**
 * CodexBackend shells out to the `codex` CLI for code implementation.
 *
 * Uses `codex exec "prompt" --full-auto` for non-interactive, sandboxed execution.
 * When streaming is enabled, uses `--json` for JSONL event output and filters
 * to show only key progress events (tool calls, file writes, thinking, etc.).
 * Codex CLI: https://github.com/openai/codex
 */
export class CodexBackend implements CodingBackend {
    readonly id = "codex";

    constructor(private readonly opts: { timeoutMs?: number } = {}) { }

    async implement(env: BackendEnv, input: ImplementInput): Promise<ImplementOutput> {
        const { task, iteration, repairNotes } = input;

        const prompt = this.buildPrompt(task, iteration, repairNotes);

        try {
            const startedAt = new Date().toISOString();
            const command = "codex";
            const argv = ["exec", prompt, "--full-auto"];

            // When streaming, add --json to get JSONL events for filtered progress
            if (env.stream) {
                argv.push("--json");
            }

            // Use task budget time limit if available, otherwise fall back to default
            const taskTimeoutMs =
                task.budget?.hard?.timeMinutes !== undefined
                    ? task.budget.hard.timeMinutes * 60_000
                    : this.opts.timeoutMs ?? 600_000; // 10 min default

            const subprocess = execa(command, argv, {
                cwd: env.cwd,
                timeout: taskTimeoutMs,
                reject: false,
                // stdin must be "ignore" (or closed immediately) to prevent codex
                // from waiting for additional stdin input ("Reading additional input
                // from stdin..." hang). stdout/stderr are piped for logging/streaming.
                stdio: ["ignore", "pipe", "pipe"],
            });

            if (env.stream) {
                // Use JSONL event stream to show filtered progress (like `plan` does)
                const startTime = Date.now();
                const ctx = createProgressCtx();
                const write = (msg: string) => process.stderr.write(msg);

                if (subprocess.stdout) {
                    attachJsonlProgress(
                        subprocess.stdout,
                        subprocess.stderr ?? null,
                        write,
                        startTime,
                        ctx,
                    );
                }
            }

            const result = await subprocess;
            const finishedAt = new Date().toISOString();
            const timedOut = (result as any).timedOut === true;

            if (env.logFile) {
                await writeBackendLog({
                    logFile: env.logFile,
                    backendId: env.backendId,
                    cwd: env.cwd,
                    command,
                    argv: argv.map((a, i) => (i === 1 ? "<prompt redacted>" : a)),
                    startedAt,
                    finishedAt,
                    exitCode: result.exitCode ?? null,
                    timedOut,
                    timeoutMs: taskTimeoutMs,
                    stdout: result.stdout,
                    stderr: result.stderr,
                });
            }

            if (result.exitCode === 0) {
                return {
                    ok: true,
                    message: `Codex completed task "${task.id}" (iteration ${iteration})`,
                };
            }

            // Handle timeout
            if (timedOut || (result.exitCode === 143 && !result.stdout && !result.stderr)) {
                const timeoutMinutes = Math.floor(taskTimeoutMs / 60_000);
                return {
                    ok: false,
                    message: `Codex timed out after ${timeoutMinutes} minute(s). The task budget allows ${task.budget?.hard?.timeMinutes ?? "N/A"} minutes.`,
                };
            }

            // Non-zero exit code
            return {
                ok: false,
                message: `Codex exited with code ${result.exitCode}: ${result.stderr || result.stdout}`.slice(0, 2000),
            };
        } catch (err: any) {
            if (err?.code === "ENOENT") {
                return {
                    ok: false,
                    message: "Codex CLI not found. Install via: npm i -g @openai/codex",
                };
            }

            return {
                ok: false,
                message: err?.message ? String(err.message).slice(0, 2000) : "Unknown error",
            };
        }
    }

    private buildPrompt(
        task: { id: string; title?: string; goal?: string },
        iteration: number,
        repairNotes?: string
    ): string {
        const lines: string[] = [];

        lines.push(`# Task: ${task.title ?? task.id}`);
        lines.push(``);

        if (task.goal) {
            lines.push(`## Goal`);
            lines.push(task.goal);
            lines.push(``);
        }

        if (repairNotes) {
            lines.push(`## Repair Notes (iteration ${iteration})`);
            lines.push(repairNotes);
            lines.push(``);
        }

        lines.push(`Please implement this task and ensure all validators pass.`);

        return lines.join("\n");
    }
}