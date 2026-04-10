import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { resolveRefs, readRefContents, RefResolutionError, REF_LIMITS } from "./refs";

describe("resolveRefs", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-refs-"));
        // Create test files
        fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "docs", "alpha.md"), "# Alpha");
        fs.writeFileSync(path.join(tmpDir, "docs", "beta.md"), "# Beta");
        fs.writeFileSync(path.join(tmpDir, "docs", "gamma.txt"), "Gamma");
        fs.writeFileSync(path.join(tmpDir, "readme.md"), "# Readme");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns empty for no patterns", async () => {
        const result = await resolveRefs([], tmpDir);
        expect(result.refs).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    it("resolves a literal file path", async () => {
        const result = await resolveRefs(["readme.md"], tmpDir);
        expect(result.refs).toHaveLength(1);
        expect(result.refs[0].relPath).toBe("readme.md");
    });

    it("expands glob patterns", async () => {
        const result = await resolveRefs(["docs/*.md"], tmpDir);
        expect(result.refs).toHaveLength(2);
        // Stable sorted by relPath
        expect(result.refs[0].relPath).toBe("docs/alpha.md");
        expect(result.refs[1].relPath).toBe("docs/beta.md");
    });

    it("deduplicates repeated patterns", async () => {
        const result = await resolveRefs(["readme.md", "readme.md"], tmpDir);
        expect(result.refs).toHaveLength(1);
    });

    it("deduplicates across literal and glob", async () => {
        const result = await resolveRefs(["docs/alpha.md", "docs/*.md"], tmpDir);
        expect(result.refs).toHaveLength(2);
    });

    it("stable-sorts by relative path", async () => {
        const result = await resolveRefs(["docs/*.md", "readme.md"], tmpDir);
        const paths = result.refs.map((r) => r.relPath);
        expect(paths).toEqual([...paths].sort());
    });

    it("throws RefResolutionError for non-existent literal file", async () => {
        await expect(resolveRefs(["nope.md"], tmpDir)).rejects.toThrow(RefResolutionError);
        await expect(resolveRefs(["nope.md"], tmpDir)).rejects.toThrow("--ref file not found");
    });

    it("throws RefResolutionError for glob matching zero files", async () => {
        await expect(resolveRefs(["docs/*.xyz"], tmpDir)).rejects.toThrow(RefResolutionError);
        await expect(resolveRefs(["docs/*.xyz"], tmpDir)).rejects.toThrow("matched zero files");
    });

    it("warns when file count exceeds maxFiles cap", async () => {
        // Create more files than the cap
        const many = REF_LIMITS.maxFiles + 5;
        fs.mkdirSync(path.join(tmpDir, "bulk"), { recursive: true });
        for (let i = 0; i < many; i++) {
            fs.writeFileSync(path.join(tmpDir, "bulk", `f${String(i).padStart(3, "0")}.md`), `# File ${i}`);
        }
        const result = await resolveRefs(["bulk/*.md"], tmpDir);
        expect(result.refs.length).toBeLessThanOrEqual(REF_LIMITS.maxFiles);
        expect(result.warnings.some((w) => w.includes("Truncated"))).toBe(true);
    });
});

describe("readRefContents", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-refs-read-"));
        fs.writeFileSync(path.join(tmpDir, "a.md"), "Content A");
        fs.writeFileSync(path.join(tmpDir, "b.md"), "Content B");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("reads contents of resolved refs into a map", async () => {
        const { refs } = await resolveRefs(["a.md", "b.md"], tmpDir);
        const contents = readRefContents(refs);
        expect(contents.get("a.md")).toBe("Content A");
        expect(contents.get("b.md")).toBe("Content B");
    });
});
