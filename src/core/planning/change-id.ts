/**
 * Change ID derivation for `ralphy-sdd plan`.
 *
 * Produces a deterministic kebab-case slug from planning input text.
 * Handles collision avoidance when a change folder already exists.
 */
import crypto from "node:crypto";

/** Maximum length for a derived change id slug. */
const MAX_SLUG_LENGTH = 50;

/**
 * Derive a kebab-case change id from input text.
 *
 * The derivation is deterministic: identical inputs produce identical slugs.
 * If the derived slug collides with an existing change folder (listed in
 * `existingChanges`), a short hash suffix is appended.
 *
 * @param input - The planning input text (prompt or PRD content)
 * @param existingChanges - Names of existing change folders (for collision check)
 * @returns A kebab-case change id, max 50 characters
 */
export function deriveChangeId(
    input: string,
    existingChanges: string[] = [],
): string {
    const base = toKebabSlug(input);

    if (!existingChanges.includes(base)) {
        return base;
    }

    // Collision: append a short hash of the full input
    const hash = shortHash(input);
    const suffixed = truncateSlug(`${base}-${hash}`, MAX_SLUG_LENGTH);

    // Extremely unlikely double collision — but handle it
    if (existingChanges.includes(suffixed)) {
        const ts = Date.now().toString(36);
        return truncateSlug(`${base}-${ts}`, MAX_SLUG_LENGTH);
    }

    return suffixed;
}

/**
 * Convert arbitrary text into a kebab-case slug.
 *
 * - Lowercases
 * - Replaces non-alphanumeric characters with hyphens
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 * - Truncates to MAX_SLUG_LENGTH
 */
function toKebabSlug(text: string): string {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-|-$/g, "");

    return truncateSlug(slug, MAX_SLUG_LENGTH);
}

/**
 * Truncate a slug to maxLen characters, avoiding a trailing hyphen.
 */
function truncateSlug(slug: string, maxLen: number): string {
    if (slug.length <= maxLen) return slug;
    let result = slug.slice(0, maxLen);
    // Don't end on a hyphen
    result = result.replace(/-+$/, "");
    return result;
}

/**
 * Produce a short (6-char) hex hash of the input for collision avoidance.
 */
function shortHash(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 6);
}
