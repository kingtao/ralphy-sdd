/**
 * OpenSpec CLI Bridge
 *
 * Lightweight bridge to the official OpenSpec CLI (`@fission-ai/openspec`).
 * Auto-detects CLI availability and version, provides typed wrappers for
 * all key commands, and falls back gracefully when the CLI is absent.
 */

import { execa, type ResultPromise } from "execa";
import { z } from "zod/v4";
import {
    OpenSpecValidationReportSchema,
    OpenSpecChangeListSchema,
    OpenSpecInstructionSchema,
    type OpenSpecValidationReport,
    type OpenSpecChangeList,
    type OpenSpecInstruction,
    type BridgeResult,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_VERSION = "1.0.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const CLI_BIN = "openspec";

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/** Parse a semver-like string into [major, minor, patch]. Returns null on failure. */
function parseSemver(raw: string): [number, number, number] | null {
    const m = raw.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Returns true if `version` >= `min` using semver comparison. */
function semverGte(version: string, min: string): boolean {
    const v = parseSemver(version);
    const m = parseSemver(min);
    if (!v || !m) return false;
    for (let i = 0; i < 3; i++) {
        if (v[i] > m[i]) return true;
        if (v[i] < m[i]) return false;
    }
    return true; // equal
}

// ---------------------------------------------------------------------------
// Detection cache
// ---------------------------------------------------------------------------

interface DetectionResult {
    available: boolean;
    version: string | null;
    reason?: string;
}

let _cached: DetectionResult | null = null;

// ---------------------------------------------------------------------------
// OpenSpecBridge
// ---------------------------------------------------------------------------

export interface ExecOptions {
    /** Working directory. Defaults to process.cwd(). */
    cwd?: string;
    /** Timeout in milliseconds. Default 30 000. */
    timeout?: number;
    /** If true, parse stdout as JSON. */
    json?: boolean;
}

export class OpenSpecBridge {
    // -----------------------------------------------------------------------
    // Detection
    // -----------------------------------------------------------------------

    /** Check if the openspec CLI is installed and meets the minimum version. */
    async isAvailable(): Promise<boolean> {
        const det = await this.detect();
        return det.available;
    }

    /** Return the detected version string, or null. */
    async getVersion(): Promise<string | null> {
        const det = await this.detect();
        return det.version;
    }

    /** Reset the cached detection (useful for testing). */
    resetCache(): void {
        _cached = null;
    }

    private async detect(): Promise<DetectionResult> {
        if (_cached) return _cached;

        try {
            const result = await execa(CLI_BIN, ["--version"], {
                timeout: 5_000,
                reject: false,
            });

            if (result.exitCode !== 0) {
                _cached = { available: false, version: null, reason: "CLI exited with non-zero code" };
                return _cached;
            }

            const version = result.stdout.trim();
            if (!parseSemver(version)) {
                _cached = { available: false, version: null, reason: `Invalid version output: "${version}"` };
                console.warn(`[openspec-bridge] Invalid version output from openspec CLI: "${version}"`);
                return _cached;
            }

            if (!semverGte(version, MIN_VERSION)) {
                _cached = { available: false, version, reason: `Version ${version} < ${MIN_VERSION}` };
                console.warn(`[openspec-bridge] openspec CLI version ${version} is below minimum ${MIN_VERSION}. Bridge disabled.`);
                return _cached;
            }

            _cached = { available: true, version };
            return _cached;
        } catch (err: any) {
            if (err?.code === "ENOENT") {
                _cached = { available: false, version: null, reason: "CLI not found on PATH" };
                console.info(`[openspec-bridge] openspec CLI not found. Install via: npm i -g @fission-ai/openspec`);
            } else {
                _cached = { available: false, version: null, reason: err?.message ?? "Unknown detection error" };
            }
            return _cached;
        }
    }

    // -----------------------------------------------------------------------
    // Generic exec
    // -----------------------------------------------------------------------

    /**
     * Execute an openspec CLI command.
     *
     * @returns raw stdout (string) or parsed JSON object when `opts.json` is true.
     * @throws on timeout, non-zero exit, or JSON parse failure.
     */
    async exec(args: string[], opts?: ExecOptions): Promise<string>;
    async exec<T = unknown>(args: string[], opts: ExecOptions & { json: true }): Promise<T>;
    async exec(args: string[], opts: ExecOptions = {}): Promise<unknown> {
        const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT_MS, json = false } = opts;

        const result = await execa(CLI_BIN, args, {
            cwd,
            timeout,
            reject: false,
            stdio: "pipe",
        });

        if ((result as any).timedOut) {
            throw new Error(`[openspec-bridge] Command timed out after ${timeout}ms: openspec ${args.join(" ")}`);
        }

        if (result.exitCode !== 0) {
            throw new Error(
                `[openspec-bridge] Command failed (exit ${result.exitCode}): openspec ${args.join(" ")}\n${result.stderr || result.stdout}`.slice(0, 2000)
            );
        }

        if (json) {
            try {
                return JSON.parse(result.stdout);
            } catch {
                throw new Error(
                    `[openspec-bridge] Failed to parse JSON output from: openspec ${args.join(" ")}\nRaw output: ${result.stdout.slice(0, 500)}`
                );
            }
        }

        return result.stdout;
    }

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------

    /**
     * Initialize OpenSpec scaffold via `openspec init`.
     * Returns `{ bridged: true }` on success, `{ bridged: false }` if CLI unavailable.
     */
    async initScaffold(
        targetPath: string,
        options?: { tools?: string[]; force?: boolean }
    ): Promise<BridgeResult> {
        if (!(await this.isAvailable())) {
            return { bridged: false, reason: "OpenSpec CLI not available" };
        }

        const args = ["init", targetPath];
        if (options?.tools?.length) {
            args.push("--tools", options.tools.join(","));
        }
        if (options?.force) {
            args.push("--force");
        }

        try {
            await this.exec(args, { cwd: targetPath, timeout: 60_000 });
            return { bridged: true };
        } catch (err: any) {
            return { bridged: false, reason: err?.message ?? "Init failed" };
        }
    }

    // -----------------------------------------------------------------------
    // Validate
    // -----------------------------------------------------------------------

    /**
     * Run `openspec validate --all --json` and return the parsed report.
     * Falls back to `{ bridged: false }` when CLI is unavailable.
     */
    async validate(cwd?: string): Promise<BridgeResult<{ report: OpenSpecValidationReport }>> {
        if (!(await this.isAvailable())) {
            return { bridged: false, reason: "OpenSpec CLI not available" };
        }

        try {
            const raw = await this.exec<unknown>(["validate", "--all", "--json"], {
                cwd,
                json: true,
                timeout: 60_000,
            });
            const report = OpenSpecValidationReportSchema.parse(raw);
            return { bridged: true, data: { report } };
        } catch (err: any) {
            return { bridged: false, reason: err?.message ?? "Validate failed" };
        }
    }

    // -----------------------------------------------------------------------
    // Archive
    // -----------------------------------------------------------------------

    /**
     * Archive a change via `openspec archive <name> --yes`.
     */
    async archiveChange(
        changeName: string,
        options?: { skipSpecs?: boolean; cwd?: string }
    ): Promise<BridgeResult> {
        if (!(await this.isAvailable())) {
            return {
                bridged: false,
                reason: "OpenSpec CLI not available. Manual archive steps:\n" +
                    `1. Apply delta specs from openspec/changes/${changeName}/specs/ to openspec/specs/\n` +
                    `2. Move openspec/changes/${changeName}/ to openspec/archive/${changeName}/`,
            };
        }

        const args = ["archive", changeName, "--yes"];
        if (options?.skipSpecs) {
            args.push("--skip-specs");
        }

        try {
            await this.exec(args, { cwd: options?.cwd, timeout: 60_000 });
            return { bridged: true };
        } catch (err: any) {
            return { bridged: false, reason: err?.message ?? "Archive failed" };
        }
    }

    // -----------------------------------------------------------------------
    // Change management
    // -----------------------------------------------------------------------

    /**
     * Create a new change directory via `openspec new change <name>`.
     */
    async createChange(name: string, cwd?: string): Promise<BridgeResult> {
        if (!(await this.isAvailable())) {
            return { bridged: false, reason: "OpenSpec CLI not available" };
        }

        try {
            await this.exec(["new", "change", name], { cwd, timeout: 30_000 });
            return { bridged: true };
        } catch (err: any) {
            return { bridged: false, reason: err?.message ?? "Create change failed" };
        }
    }

    /**
     * Get enriched instructions for an artifact via `openspec instructions`.
     */
    async getInstructions(
        artifact: string,
        changeName: string,
        cwd?: string
    ): Promise<BridgeResult<{ instruction: OpenSpecInstruction }>> {
        if (!(await this.isAvailable())) {
            return { bridged: false, reason: "OpenSpec CLI not available" };
        }

        try {
            const raw = await this.exec<unknown>(
                ["instructions", artifact, "--change", changeName, "--json"],
                { cwd, json: true, timeout: 30_000 }
            );
            const instruction = OpenSpecInstructionSchema.parse(raw);
            return { bridged: true, data: { instruction } };
        } catch (err: any) {
            return { bridged: false, reason: err?.message ?? "Get instructions failed" };
        }
    }

    // -----------------------------------------------------------------------
    // Query
    // -----------------------------------------------------------------------

    /**
     * List changes via `openspec list --json`.
     */
    async listChanges(cwd?: string): Promise<BridgeResult<{ changes: OpenSpecChangeList }>> {
        if (!(await this.isAvailable())) {
            return { bridged: false, reason: "OpenSpec CLI not available" };
        }

        try {
            const raw = await this.exec<unknown>(["list", "--json"], {
                cwd,
                json: true,
                timeout: 30_000,
            });
            const changes = OpenSpecChangeListSchema.parse(raw);
            return { bridged: true, data: { changes } };
        } catch (err: any) {
            return { bridged: false, reason: err?.message ?? "List changes failed" };
        }
    }

    /**
     * Get change status via `openspec status --change <name> --json`.
     */
    async getChangeStatus(
        changeName: string,
        cwd?: string
    ): Promise<BridgeResult<{ status: unknown }>> {
        if (!(await this.isAvailable())) {
            return { bridged: false, reason: "OpenSpec CLI not available" };
        }

        try {
            const raw = await this.exec<unknown>(
                ["status", "--change", changeName, "--json"],
                { cwd, json: true, timeout: 30_000 }
            );
            return { bridged: true, data: { status: raw } };
        } catch (err: any) {
            return { bridged: false, reason: err?.message ?? "Get status failed" };
        }
    }
}
