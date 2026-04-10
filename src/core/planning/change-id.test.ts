import { describe, it, expect } from "vitest";
import { deriveChangeId } from "./change-id";

describe("deriveChangeId", () => {
    it("produces a kebab-case slug from input text", () => {
        const id = deriveChangeId("I want to add user authentication");
        expect(id).toBe("i-want-to-add-user-authentication");
    });

    it("handles special characters", () => {
        const id = deriveChangeId("Add OAuth2.0 + SSO support!");
        expect(id).toBe("add-oauth2-0-sso-support");
    });

    it("collapses consecutive non-alpha chars", () => {
        const id = deriveChangeId("hello---world   foo");
        expect(id).toBe("hello-world-foo");
    });

    it("is stable for identical inputs", () => {
        const a = deriveChangeId("Build a new website");
        const b = deriveChangeId("Build a new website");
        expect(a).toBe(b);
    });

    it("truncates to 50 characters max", () => {
        const longInput =
            "This is a very long input text that should be truncated to fifty characters maximum for the slug";
        const id = deriveChangeId(longInput);
        expect(id.length).toBeLessThanOrEqual(50);
        // Should not end with a hyphen
        expect(id.endsWith("-")).toBe(false);
    });

    it("does not end with a hyphen after truncation", () => {
        // Craft an input where the 50th character would be right after a hyphen
        const input = "a".repeat(49) + " " + "b".repeat(10);
        const id = deriveChangeId(input);
        expect(id.endsWith("-")).toBe(false);
        expect(id.length).toBeLessThanOrEqual(50);
    });

    it("returns base slug when no collision", () => {
        const id = deriveChangeId("add search filters", ["other-change"]);
        expect(id).toBe("add-search-filters");
    });

    it("appends hash suffix on collision", () => {
        const existing = ["add-search-filters"];
        const id = deriveChangeId("add search filters", existing);
        expect(id).not.toBe("add-search-filters");
        expect(id.startsWith("add-search-filters-")).toBe(true);
        expect(id.length).toBeLessThanOrEqual(50);
    });

    it("collision suffix is deterministic", () => {
        const existing = ["add-search-filters"];
        const a = deriveChangeId("add search filters", existing);
        const b = deriveChangeId("add search filters", existing);
        expect(a).toBe(b);
    });

    it("handles empty input", () => {
        const id = deriveChangeId("");
        expect(id).toBe("");
    });

    it("handles purely non-alpha input", () => {
        const id = deriveChangeId("!!!@@@###");
        expect(id).toBe("");
    });
});
