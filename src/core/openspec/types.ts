/**
 * OpenSpec CLI Bridge — Shared Types
 *
 * Zod schemas for defensive parsing of OpenSpec CLI JSON output,
 * plus TypeScript types inferred from them.
 */

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Bridge result wrapper
// ---------------------------------------------------------------------------

/** Result type for all bridge methods. `bridged: true` means the CLI was used. */
export type BridgeResult<T = void> =
    | { bridged: true; data?: T }
    | { bridged: false; reason: string };

// ---------------------------------------------------------------------------
// Validation Report (from `openspec validate --all --json`)
// ---------------------------------------------------------------------------

export const OpenSpecValidationIssueSchema = z.object({
    level: z.enum(["ERROR", "WARNING", "INFO"]),
    path: z.string().optional(),
    message: z.string(),
});

export const OpenSpecValidationItemSchema = z.object({
    id: z.string(),
    type: z.enum(["change", "spec"]),
    valid: z.boolean(),
    issues: z.array(OpenSpecValidationIssueSchema),
    durationMs: z.number().optional(),
});

export const OpenSpecValidationReportSchema = z.object({
    items: z.array(OpenSpecValidationItemSchema),
    summary: z.object({
        totals: z.object({
            items: z.number(),
            passed: z.number(),
            failed: z.number(),
        }),
        byType: z.record(
            z.string(),
            z.object({
                items: z.number(),
                passed: z.number(),
                failed: z.number(),
            })
        ),
    }),
    version: z.string().optional(),
});

export type OpenSpecValidationReport = z.infer<typeof OpenSpecValidationReportSchema>;
export type OpenSpecValidationIssue = z.infer<typeof OpenSpecValidationIssueSchema>;
export type OpenSpecValidationItem = z.infer<typeof OpenSpecValidationItemSchema>;

// ---------------------------------------------------------------------------
// Change List (from `openspec list --json`)
// ---------------------------------------------------------------------------

export const OpenSpecChangeEntrySchema = z.object({
    name: z.string(),
    completedTasks: z.number(),
    totalTasks: z.number(),
    lastModified: z.string(),
    status: z.string(),
});

export const OpenSpecChangeListSchema = z.object({
    changes: z.array(OpenSpecChangeEntrySchema),
});

export type OpenSpecChangeList = z.infer<typeof OpenSpecChangeListSchema>;
export type OpenSpecChangeEntry = z.infer<typeof OpenSpecChangeEntrySchema>;

// ---------------------------------------------------------------------------
// Instruction (from `openspec instructions <artifact> --change <id> --json`)
// ---------------------------------------------------------------------------

export const OpenSpecInstructionSchema = z.object({
    changeName: z.string(),
    artifactId: z.string(),
    schemaName: z.string().optional(),
    changeDir: z.string().optional(),
    outputPath: z.string().optional(),
    description: z.string().optional(),
    instruction: z.string(),
    template: z.string().optional(),
    dependencies: z.array(z.string()).optional(),
    unlocks: z.array(z.string()).optional(),
});

export type OpenSpecInstruction = z.infer<typeof OpenSpecInstructionSchema>;
