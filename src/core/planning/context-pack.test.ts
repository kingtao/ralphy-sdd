import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { buildContextPack, type ContextPackInput } from "./context-pack";

describe("buildContextPack", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-ctx-"));
        // Create minimal openspec scaffold
        fs.mkdirSync(path.join(tmpDir, "openspec", "specs"), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, "openspec", "project.md"),
            "# Test Project\n\nA test project.\n",
        );
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function baseInput(overrides?: Partial<ContextPackInput>): ContextPackInput {
        return {
            userInput: "I want to add user authentication",
            inputSource: "prompt",
            refs: [],
            repoRoot: tmpDir,
            backendId: "noop",
            changeId: "add-user-auth",
            ...overrides,
        };
    }

    it("produces a non-empty text with required sections", async () => {
        const pack = await buildContextPack(baseInput());
        expect(pack.text.length).toBeGreaterThan(0);
        // Must have core sections
        expect(pack.sections).toContain("plan-mode-constraints");
        expect(pack.sections).toContain("user-input");
        expect(pack.sections).toContain("change-id");
        expect(pack.sections).toContain("project-context");
    });

    it("uses fallback template when no installed template exists", async () => {
        const pack = await buildContextPack(baseInput());
        expect(pack.sections).toContain("planning-template (fallback)");
        expect(pack.text).toContain("PLAN MODE");
    });

    it("uses installed template when available", async () => {
        // Create a claude-code planning template
        const templateDir = path.join(tmpDir, ".claude", "commands");
        fs.mkdirSync(templateDir, { recursive: true });
        fs.writeFileSync(
            path.join(templateDir, "ralphy-plan.md"),
            "# Custom Plan Template\n\nPlan for {{changeId}}.\n",
        );

        const pack = await buildContextPack(
            baseInput({ backendId: "claude-code" }),
        );
        expect(pack.sections).toContain("planning-template");
        expect(pack.text).toContain("Custom Plan Template");
        expect(pack.text).toContain("Plan for add-user-auth");
    });

    it("includes user input section", async () => {
        const pack = await buildContextPack(baseInput());
        expect(pack.text).toContain("I want to add user authentication");
        expect(pack.text).toContain("User Input (prompt)");
    });

    it("includes file source label for file inputs", async () => {
        const pack = await buildContextPack(
            baseInput({ inputSource: "file", inputFile: "/tmp/prd.md" }),
        );
        expect(pack.text).toContain("User Input (from file: /tmp/prd.md)");
    });

    it("includes change id section", async () => {
        const pack = await buildContextPack(baseInput());
        expect(pack.text).toContain("`add-user-auth`");
        expect(pack.text).toContain("openspec/changes/add-user-auth/");
    });

    it("includes project context when project.md exists", async () => {
        const pack = await buildContextPack(baseInput());
        expect(pack.text).toContain("A test project.");
        expect(pack.sections).toContain("project-context");
    });

    it("omits project context when project.md is missing", async () => {
        fs.unlinkSync(path.join(tmpDir, "openspec", "project.md"));
        const pack = await buildContextPack(baseInput());
        expect(pack.sections).not.toContain("project-context");
    });

    it("includes existing spec summaries", async () => {
        fs.mkdirSync(path.join(tmpDir, "openspec", "specs", "auth"), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, "openspec", "specs", "auth", "spec.md"),
            "# Auth Spec\n\nSome auth details.\n",
        );

        const pack = await buildContextPack(baseInput());
        expect(pack.sections).toContain("existing-specs");
        expect(pack.text).toContain("Auth Spec");
    });

    it("includes reference file contents", async () => {
        const refFile = path.join(tmpDir, "ref.md");
        fs.writeFileSync(refFile, "Reference content here");

        const pack = await buildContextPack(
            baseInput({
                refs: [
                    { absPath: refFile, relPath: "ref.md", bytes: 22 },
                ],
            }),
        );
        expect(pack.sections).toContain("reference-files");
        expect(pack.text).toContain("Reference content here");
    });

    it("is deterministic for identical inputs", async () => {
        const input = baseInput();
        const pack1 = await buildContextPack(input);
        const pack2 = await buildContextPack(input);
        expect(pack1.text).toBe(pack2.text);
        expect(pack1.sections).toEqual(pack2.sections);
    });

    it("always includes PLAN MODE constraints", async () => {
        const pack = await buildContextPack(baseInput());
        expect(pack.text).toContain("PLAN MODE — Scope Restrictions");
        expect(pack.text).toContain("FORBIDDEN");
        expect(pack.text).toContain("ALLOWED");
    });
});
