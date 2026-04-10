export type ToolId = "codex" | "claude-code" | "opencode";

export type InitOptions = {
  dir: string;
  tools?: ToolId[];
  force: boolean;
};

export type ValidationIssue = {
  level: "error" | "warning";
  message: string;
  path?: string;
};

