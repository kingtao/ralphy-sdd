/**
 * OpenSpec CLI Bridge — Public API
 */

export { OpenSpecBridge } from "./bridge.js";
export type { ExecOptions } from "./bridge.js";

export type {
    BridgeResult,
    OpenSpecValidationReport,
    OpenSpecValidationIssue,
    OpenSpecValidationItem,
    OpenSpecChangeList,
    OpenSpecChangeEntry,
    OpenSpecInstruction,
} from "./types.js";

export {
    OpenSpecValidationReportSchema,
    OpenSpecValidationIssueSchema,
    OpenSpecValidationItemSchema,
    OpenSpecChangeListSchema,
    OpenSpecChangeEntrySchema,
    OpenSpecInstructionSchema,
} from "./types.js";

import { OpenSpecBridge } from "./bridge.js";

/** Default singleton instance. */
export const openspec = new OpenSpecBridge();