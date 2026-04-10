/**
 * Reference file resolution for `ralphy-sdd plan --ref`.
 *
 * Supports repeatable `--ref` flags with glob patterns.
 * Resolves relative to repo root, deduplicates, stable-sorts,
 * and enforces hard caps on count and total bytes.
 */
import path from "node:path";
import fs from "node:fs";
import fg from "fast-glob";

/** Hard limits to keep planning context bounded. */
export const REF_LIMITS = {
    maxFiles: 20,
    maxTotalBytes: 512 * 1024, // 512 KB
} as const;

export type ResolvedRef = {
    /** Absolute path */
    absPath: string;
    /** Path relative to repoRoot */
    relPath: string;
    /** File size in bytes */
    bytes: number;
};

export type RefResolutionResult = {
    refs: ResolvedRef[];
    /** Warnings about truncation, etc. */
    warnings: string[];
};

/**
 * Resolve an array of `--ref` patterns (file paths or globs) into
 * a deduplicated, stable-sorted list of resolved files.
 *
 * @throws {RefResolutionError} if any pattern matches zero files
 */
export async function resolveRefs(
    patterns: string[],
    repoRoot: string,
): Promise<RefResolutionResult> {
    if (patterns.length === 0) {
        return { refs: [], warnings: [] };
    }

    const warnings: string[] = [];
    const seenAbs = new Set<string>();
    const allRefs: ResolvedRef[] = [];

    for (const pattern of patterns) {
        // Check if it's a literal file path first (no glob chars)
        const isGlob = /[*?{}\[\]]/.test(pattern);
        let matchedPaths: string[];

        if (isGlob) {
            // Expand glob relative to repoRoot
            matchedPaths = await fg(pattern, {
                cwd: repoRoot,
                absolute: false,
                onlyFiles: true,
                dot: false,
                followSymbolicLinks: false,
            });

            if (matchedPaths.length === 0) {
                throw new RefResolutionError(
                    `--ref glob "${pattern}" matched zero files`,
                    pattern,
                );
            }
        } else {
            // Treat as literal file path
            const abs = path.resolve(repoRoot, pattern);
            if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
                throw new RefResolutionError(
                    `--ref file not found: "${pattern}"`,
                    pattern,
                );
            }
            matchedPaths = [path.relative(repoRoot, abs)];
        }

        // Deduplicate and collect
        for (const rel of matchedPaths) {
            const abs = path.resolve(repoRoot, rel);
            if (seenAbs.has(abs)) continue;
            seenAbs.add(abs);

            const stat = fs.statSync(abs);
            allRefs.push({
                absPath: abs,
                relPath: rel,
                bytes: stat.size,
            });
        }
    }

    // Stable sort by relative path (lexicographic)
    allRefs.sort((a, b) => a.relPath.localeCompare(b.relPath));

    // Enforce hard caps
    let result = allRefs;

    if (result.length > REF_LIMITS.maxFiles) {
        warnings.push(
            `Truncated refs from ${result.length} to ${REF_LIMITS.maxFiles} files (hard cap)`,
        );
        result = result.slice(0, REF_LIMITS.maxFiles);
    }

    let totalBytes = 0;
    const bounded: ResolvedRef[] = [];
    for (const ref of result) {
        if (totalBytes + ref.bytes > REF_LIMITS.maxTotalBytes) {
            warnings.push(
                `Stopped including refs at ${bounded.length} files / ${totalBytes} bytes ` +
                `(would exceed ${REF_LIMITS.maxTotalBytes} byte cap)`,
            );
            break;
        }
        bounded.push(ref);
        totalBytes += ref.bytes;
    }

    return { refs: bounded, warnings };
}

/**
 * Read all resolved refs into a map of relPath → content.
 * Suitable for inclusion in the planning context pack.
 */
export function readRefContents(
    refs: ResolvedRef[],
): Map<string, string> {
    const contents = new Map<string, string>();
    for (const ref of refs) {
        contents.set(ref.relPath, fs.readFileSync(ref.absPath, "utf-8"));
    }
    return contents;
}

export class RefResolutionError extends Error {
    constructor(
        message: string,
        public readonly pattern: string,
    ) {
        super(message);
        this.name = "RefResolutionError";
    }
}
