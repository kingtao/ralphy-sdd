import type { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import { resolveProjectDir } from "../utils/paths";
import { executePlanPipeline, type PlanResult } from "../core/planning/index";

/**
 * Resolve user input: if the argument is an existing file path, read its
 * contents; otherwise treat the argument as literal prompt text.
 */
function resolveInput(
    raw: string,
    repoRoot: string,
): { text: string; source: "file" | "prompt"; file?: string } {
    const candidate = path.resolve(repoRoot, raw);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { text: fs.readFileSync(candidate, "utf-8"), source: "file", file: candidate };
    }
    return { text: raw, source: "prompt" };
}

export type PlanOptions = {
    dir: string;
    backend: string;
    artifactDir?: string;
    ref: string[];
    change?: string;
    json: boolean;
};

export function registerPlanCommand(program: Command): void {
    program
        .command("plan <input>")
        .description(
            "Generate an OpenSpec change + task plan from a prompt or PRD file.\n" +
            "  <input> can be a quoted prompt string or a path to a .md/.txt file.",
        )
        .option("--dir <path>", "Target repo root (default: cwd)")
        .option(
            "--backend <id>",
            "Backend id: codex|opencode|claude-code|noop",
        )
        .option("--artifact-dir <dir>", "Override artifact root directory (enables artifacts)")
        .option(
            "--ref <fileOrGlob>",
            "Reference file(s) to include in planning context (repeatable; globs supported)",
            // Commander collect pattern: accumulate repeated --ref into an array
            (val: string, acc: string[]) => {
                acc.push(val);
                return acc;
            },
            [] as string[],
        )
        .option("--change <slug>", "Explicit change id (kebab-case)")
        .option("--json", "Machine-readable JSON output", false)
        .addHelpText(
            "after",
            `\nExamples:\n` +
            `  $ ralphy-sdd plan "I want to add user authentication"\n` +
            `  $ ralphy-sdd plan prd.md --ref docs/api.md --ref docs/schema.md\n` +
            `  $ ralphy-sdd plan prd.md --backend noop --json\n`,
        )
        .action(async (input: string, opts: {
            dir?: string;
            backend?: string;
            artifactDir?: string;
            ref: string[];
            change?: string;
            json: boolean;
        }) => {
            const repoRoot = resolveProjectDir(opts.dir);

            // --- 1. Resolve input (file or prompt) ---
            const resolved = resolveInput(input, repoRoot);
            if (!resolved.text.trim()) {
                const msg = "Plan input is empty.";
                if (opts.json) {
                    process.stdout.write(JSON.stringify({ ok: false, exitCode: 4, error: msg }) + "\n");
                } else {
                    process.stderr.write(`ERROR: ${msg}\n`);
                }
                process.exitCode = 4;
                return;
            }

            // --- 2. Resolve backend default ---
            let defaultBackend = "opencode";
            try {
                const { SpecLoader } = await import("../core/spec/loader");
                const loader = new SpecLoader(repoRoot);
                const spec = await loader.loadProjectSpec();
                defaultBackend = spec.defaults.backend ?? "opencode";
            } catch {
                // No valid spec yet — acceptable during initial planning
            }
            const backendId = opts.backend ?? defaultBackend;

            // --- 3. Collect plan options ---
            const planOpts: PlanOptions = {
                dir: repoRoot,
                backend: backendId,
                artifactDir: opts.artifactDir,
                ref: opts.ref,
                change: opts.change,
                json: opts.json,
            };

            // --- 4. Execute the full planning pipeline ---
            let result: PlanResult;
            try {
                result = await executePlanPipeline(planOpts, resolved);
            } catch (err: any) {
                const errorResult: PlanResult = {
                    ok: false,
                    exitCode: 6,
                    error: `Plan failed: ${err?.message ?? "unknown error"}`,
                };
                if (opts.json) {
                    process.stdout.write(JSON.stringify(errorResult, null, 2) + "\n");
                } else {
                    process.stderr.write(`ERROR: ${errorResult.error}\n`);
                }
                process.exitCode = 6;
                return;
            }

            // --- 5. Output results ---
            if (opts.json) {
                process.stdout.write(JSON.stringify(result, null, 2) + "\n");
            } else if (result.ok) {
                process.stdout.write(
                    `✅ Plan completed!\n` +
                    `  Change: ${result.changeId}\n` +
                    `  Run ID: ${result.runId}\n` +
                    `  Files:  ${result.writtenFiles?.length ?? 0} written\n` +
                    (result.warnings && result.warnings.length > 0
                        ? `  Warnings: ${result.warnings.length}\n`
                        : "") +
                    `\nNext: ralphy-sdd run\n`,
                );
            } else {
                process.stderr.write(
                    `❌ Plan failed (exit ${result.exitCode})\n` +
                    (result.error ? `  Error: ${result.error}\n` : "") +
                    (result.changeId ? `  Change: ${result.changeId}\n` : "") +
                    (result.warnings && result.warnings.length > 0
                        ? `  Warnings:\n${result.warnings.map((w) => `    - ${w}`).join("\n")}\n`
                        : ""),
                );
            }

            process.exitCode = result.exitCode;
        });
}