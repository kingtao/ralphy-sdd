/**
 * Change ID derivation for `ralphy-sdd plan`.
 *
 * Produces a deterministic kebab-case slug from planning input text.
 * Handles collision avoidance when a change folder already exists.
 * Supports AI-assisted slug generation for non-ASCII (e.g. Chinese) input.
 */
import crypto from "node:crypto";
import { execa } from "execa";

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

/** Returns true if the text contains non-ASCII characters (Chinese, Japanese, etc.) */
function hasNonAscii(text: string): boolean {
    return /[^\x00-\x7F]/.test(text);
}

/**
 * AI-assisted change id derivation.
 *
 * When the input contains non-ASCII characters (e.g. Chinese), pure text
 * slugification discards all non-ASCII chars producing poor results.
 * This function first tries to use an AI CLI tool to summarize the input
 * into a short English slug. Falls back to {@link deriveChangeId} on failure.
 *
 * @param input - The planning input text (prompt or PRD content)
 * @param existingChanges - Names of existing change folders (for collision check)
 * @param backendId - Which backend CLI to use for slug generation
 * @returns A kebab-case change id, max 50 characters
 */
export async function deriveChangeIdWithAI(
    input: string,
    existingChanges: string[] = [],
    backendId: string = "codex",
): Promise<string> {
    // If input is purely ASCII, the normal slug derivation is fine
    if (!hasNonAscii(input)) {
        return deriveChangeId(input, existingChanges);
    }

    // Try AI-assisted slug generation
    try {
        const slug = await generateSlugViaAI(input, backendId);
        if (slug) {
            const base = toKebabSlug(slug);
            if (base && base.length >= 3) {
                if (!existingChanges.includes(base)) {
                    return base;
                }
                // Handle collision
                const hash = shortHash(input);
                return truncateSlug(`${base}-${hash}`, MAX_SLUG_LENGTH);
            }
        }
    } catch {
        // AI call failed, fall through to deterministic fallback
    }

    // Fallback: extract English words + short hash
    return deriveChangeIdFallback(input, existingChanges);
}

/**
 * Deterministic fallback for non-ASCII input when AI is unavailable.
 * Extracts English words from the input, deduplicates them, and appends
 * a short hash if the result is too short or empty.
 */
function deriveChangeIdFallback(
    input: string,
    existingChanges: string[] = [],
): string {
    // Extract English words (2+ chars), deduplicate, join
    const englishWords = input
        .toLowerCase()
        .match(/[a-z][a-z0-9]+/g) ?? [];
    const unique = [...new Set(englishWords)];
    const wordsSlug = truncateSlug(unique.join("-"), MAX_SLUG_LENGTH - 7);

    let base: string;
    if (wordsSlug && wordsSlug.length >= 3) {
        base = wordsSlug;
    } else {
        // No meaningful English words; use "change-" + hash
        base = `change-${shortHash(input)}`;
    }

    if (!existingChanges.includes(base)) {
        return base;
    }
    const hash = shortHash(input);
    return truncateSlug(`${base}-${hash}`, MAX_SLUG_LENGTH);
}

const SLUG_PROMPT = `You are a slug generator. Given a description (possibly in Chinese or other languages), output ONLY a short English kebab-case slug (3-6 words, lowercase, hyphens between words, no quotes, no explanation). Example: "backend-cli-streaming"

Description: `;

/**
 * Call an AI backend CLI to generate an English slug from the input.
 * Uses a lightweight prompt with short timeout.
 */
async function generateSlugViaAI(
    input: string,
    backendId: string,
): Promise<string | null> {
    const prompt = SLUG_PROMPT + input.slice(0, 200);
    const timeout = 30_000; // 30s max

    let command: string;
    let args: string[];
    let stdinPrompt: string | undefined;

    switch (backendId) {
        case "codex":
            command = "codex";
            args = ["exec", "--full-auto", "--json"];
            stdinPrompt = prompt;
            break;
        case "claude-code":
            command = "claude";
            args = ["--print", prompt];
            break;
        case "opencode":
            command = "opencode";
            args = ["--prompt", prompt];
            break;
        default:
            return null;
    }

    const result = await execa(command, args, {
        timeout,
        reject: false,
        ...(stdinPrompt ? { input: stdinPrompt } : {}),
        stdio: stdinPrompt ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });

    if (result.exitCode !== 0) return null;

    let output = (result.stdout ?? "").trim();

    // For codex --json mode, parse JSONL to extract the text content
    if (backendId === "codex" && output.includes("{")) {
        output = extractCodexTextOutput(output);
    }

    // Clean up: strip quotes, backticks, markdown, extra whitespace
    output = output
        .replace(/^[`"']+|[`"']+$/g, "")
        .replace(/\n/g, " ")
        .trim();

    // Validate: should look like a kebab-case slug
    const slugCandidate = output
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-|-$/g, "");

    if (slugCandidate.length >= 3 && slugCandidate.length <= MAX_SLUG_LENGTH) {
        return slugCandidate;
    }

    return null;
}

/**
 * Extract text content from codex JSONL output.
 * Looks for item.completed events with text content.
 */
function extractCodexTextOutput(jsonlOutput: string): string {
    const lines = jsonlOutput.split("\n");
    for (const line of lines) {
        try {
            const event = JSON.parse(line.trim());
            if (event.type === "item.completed" && event.item?.text) {
                return event.item.text;
            }
            // Also check for message content
            if (event.type === "item.completed" && event.item?.content) {
                const content = event.item.content;
                if (Array.isArray(content)) {
                    for (const part of content) {
                        if (part.type === "output_text" && part.text) return part.text;
                        if (part.text) return part.text;
                    }
                }
                if (typeof content === "string") return content;
            }
        } catch {
            // Not JSON, skip
        }
    }
    return jsonlOutput;
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
