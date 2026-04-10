/**
 * OpenSpec CLI Bridge — Public API
 */

export { OpenSpecBridge } from "./bridge";
export type { ExecOptions } from "./bridge";

export type {
    BridgeResult,
    OpenSpecValidationReport,
    OpenSpecValidationIssue,
    OpenSpecValidationItem,
    OpenSpecChangeList,
    OpenSpecChangeEntry,
    OpenSpecInstruction,
} from "./types";

export {
    OpenSpecValidationReportSchema,
    OpenSpecValidationIssueSchema,
    OpenSpecValidationItemSchema,
    OpenSpecChangeListSchema,
    OpenSpecChangeEntrySchema,
    OpenSpecInstructionSchema,
} from "./types";

import { OpenSpecBridge } from "./bridge";

/** Default singleton instance. */
export const openspec = new OpenSpecBridge();