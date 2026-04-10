import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenSpecBridge } from "./bridge";

// We mock execa at the module level
vi.mock("execa", () => ({
    execa: vi.fn(),
}));

import { execa } from "execa";
const mockExeca = vi.mocked(execa);

describe("OpenSpecBridge", () => {
    let bridge: OpenSpecBridge;

    beforeEach(() => {
        bridge = new OpenSpecBridge();
        bridge.resetCache();
        vi.clearAllMocks();
    });

    afterEach(() => {
        bridge.resetCache();
    });

    // -------------------------------------------------------------------------
    // Detection / isAvailable
    // -------------------------------------------------------------------------

    describe("isAvailable()", () => {
        it("returns true when CLI version >= 1.0.0", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "1.2.0",
                stderr: "",
            } as any);

            expect(await bridge.isAvailable()).toBe(true);
            expect(await bridge.getVersion()).toBe("1.2.0");
        });

        it("returns true for version exactly 1.0.0", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "1.0.0",
                stderr: "",
            } as any);

            expect(await bridge.isAvailable()).toBe(true);
        });

        it("returns false when version < 1.0.0", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "0.9.5",
                stderr: "",
            } as any);

            expect(await bridge.isAvailable()).toBe(false);
            expect(await bridge.getVersion()).toBe("0.9.5");
            warnSpy.mockRestore();
        });

        it("returns false when CLI is not found (ENOENT)", async () => {
            const infoSpy = vi.spyOn(console, "info").mockImplementation(() => { });
            const err = new Error("not found") as any;
            err.code = "ENOENT";
            mockExeca.mockRejectedValueOnce(err);

            expect(await bridge.isAvailable()).toBe(false);
            expect(await bridge.getVersion()).toBeNull();
            infoSpy.mockRestore();
        });

        it("returns false when version output is garbage", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "not-a-version",
                stderr: "",
            } as any);

            expect(await bridge.isAvailable()).toBe(false);
            warnSpy.mockRestore();
        });

        it("returns false when CLI exits with non-zero code", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: 1,
                stdout: "",
                stderr: "error",
            } as any);

            expect(await bridge.isAvailable()).toBe(false);
        });

        it("caches detection result", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "1.2.0",
                stderr: "",
            } as any);

            await bridge.isAvailable();
            await bridge.isAvailable();
            await bridge.isAvailable();

            // execa should only be called once (for --version)
            expect(mockExeca).toHaveBeenCalledTimes(1);
        });

        it("resetCache() allows re-detection", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "1.0.0",
                stderr: "",
            } as any);

            await bridge.isAvailable();
            bridge.resetCache();

            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "1.3.0",
                stderr: "",
            } as any);

            expect(await bridge.getVersion()).toBe("1.3.0");
            expect(mockExeca).toHaveBeenCalledTimes(2);
        });
    });

    // -------------------------------------------------------------------------
    // exec()
    // -------------------------------------------------------------------------

    describe("exec()", () => {
        it("returns stdout on success", async () => {
            // exec() calls execa directly (no detection)
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "hello world",
                stderr: "",
            } as any);

            const result = await bridge.exec(["list"]);
            expect(result).toBe("hello world");
        });

        it("parses JSON when json option is true", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '{"changes":[]}',
                stderr: "",
            } as any);

            const result = await bridge.exec(["list", "--json"], { json: true });
            expect(result).toEqual({ changes: [] });
        });

        it("throws on non-zero exit code", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: 1,
                stdout: "",
                stderr: "something failed",
            } as any);

            await expect(bridge.exec(["bad-command"])).rejects.toThrow("Command failed");
        });

        it("throws on timeout", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: null,
                stdout: "",
                stderr: "",
                timedOut: true,
            } as any);

            await expect(bridge.exec(["slow-command"], { timeout: 100 })).rejects.toThrow(
                "timed out"
            );
        });

        it("throws on JSON parse failure", async () => {
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "not valid json {{{",
                stderr: "",
            } as any);

            await expect(
                bridge.exec(["list", "--json"], { json: true })
            ).rejects.toThrow("Failed to parse JSON");
        });
    });

    // -------------------------------------------------------------------------
    // Bridge methods (unavailable fallback)
    // -------------------------------------------------------------------------

    describe("bridge methods when CLI unavailable", () => {
        beforeEach(() => {
            const err = new Error("not found") as any;
            err.code = "ENOENT";
            mockExeca.mockRejectedValueOnce(err);
            vi.spyOn(console, "info").mockImplementation(() => { });
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("initScaffold returns bridged: false", async () => {
            const result = await bridge.initScaffold("/tmp/test");
            expect(result.bridged).toBe(false);
        });

        it("validate returns bridged: false", async () => {
            const result = await bridge.validate("/tmp/test");
            expect(result.bridged).toBe(false);
        });

        it("archiveChange returns bridged: false with manual instructions", async () => {
            const result = await bridge.archiveChange("my-change");
            expect(result.bridged).toBe(false);
            if (!result.bridged) {
                expect(result.reason).toContain("Manual archive steps");
            }
        });

        it("createChange returns bridged: false", async () => {
            const result = await bridge.createChange("my-feature");
            expect(result.bridged).toBe(false);
        });

        it("getInstructions returns bridged: false", async () => {
            const result = await bridge.getInstructions("proposal", "my-feature");
            expect(result.bridged).toBe(false);
        });

        it("listChanges returns bridged: false", async () => {
            const result = await bridge.listChanges();
            expect(result.bridged).toBe(false);
        });

        it("getChangeStatus returns bridged: false", async () => {
            const result = await bridge.getChangeStatus("my-feature");
            expect(result.bridged).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // Validate (with CLI available)
    // -------------------------------------------------------------------------

    describe("validate() with CLI available", () => {
        beforeEach(() => {
            // Prime the detection cache as "available"
            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: "1.2.0",
                stderr: "",
            } as any);
        });

        it("parses a real validation report", async () => {
            // Validate command (detection is already primed in beforeEach)
            const report = {
                items: [
                    {
                        id: "my-change",
                        type: "change",
                        valid: false,
                        issues: [
                            {
                                level: "ERROR",
                                path: "core/spec.md",
                                message: 'ADDED "Some requirement" must contain SHALL or MUST',
                            },
                        ],
                        durationMs: 42,
                    },
                ],
                summary: {
                    totals: { items: 1, passed: 0, failed: 1 },
                    byType: {
                        change: { items: 1, passed: 0, failed: 1 },
                        spec: { items: 0, passed: 0, failed: 0 },
                    },
                },
                version: "1.0",
            };

            mockExeca.mockResolvedValueOnce({
                exitCode: 0,
                stdout: JSON.stringify(report),
                stderr: "",
            } as any);

            // Trigger detection first (uses the primed mock from beforeEach)
            await bridge.isAvailable();

            const result = await bridge.validate("/tmp/test");
            expect(result.bridged).toBe(true);
            if (result.bridged && result.data) {
                expect(result.data.report.items).toHaveLength(1);
                expect(result.data.report.items[0].issues[0].level).toBe("ERROR");
                expect(result.data.report.summary.totals.failed).toBe(1);
            }
        });
    });
});
