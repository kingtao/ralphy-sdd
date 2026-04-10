import fs from "node:fs/promises";
import path from "node:path";
import type { ToolId, ValidationIssue } from "../types";
import { DEFAULT_ROOT_DIR, LEGACY_ROOT_DIR } from "../core/folders";
import { openspec } from "../core/openspec/index";
import type { OpenSpecValidationIssue } from "../core/openspec/types";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Map OpenSpec CLI validation issue level to ralphy-sdd level. */
function mapLevel(level: OpenSpecValidationIssue["level"]): ValidationIssue["level"] {
  switch (level) {
    case "ERROR":
      return "error";
    case "WARNING":
    case "INFO":
      return "warning";
  }
}

export async function validateProject(
  projectDir: string,
  tools: ToolId[]
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // ---- Built-in directory checks (always run) ----
  const openspecDir = path.join(projectDir, "openspec");
  if (!(await exists(openspecDir))) {
    issues.push({
      level: "error",
      message: "Missing openspec directory. Run `ralphy-openspec init`.",
      path: "openspec/",
    });
    return issues;
  }

  for (const p of ["openspec/specs", "openspec/changes", "openspec/project.md"]) {
    if (!(await exists(path.join(projectDir, p)))) {
      issues.push({ level: "error", message: `Missing ${p}`, path: p });
    }
  }

  if (tools.includes("codex")) {
    const p = "codex (no template needed)";
    if (!(await exists(path.join(projectDir, p)))) {
      issues.push({ level: "warning", message: `Missing ${p}`, path: p });
    }
  }

  if (tools.includes("claude-code")) {
    const p = ".claude/commands/ralphy-plan.md";
    if (!(await exists(path.join(projectDir, p)))) {
      issues.push({ level: "warning", message: `Missing ${p}`, path: p });
    }
  }

  if (tools.includes("opencode")) {
    const p = "AGENTS.md";
    if (!(await exists(path.join(projectDir, p)))) {
      issues.push({ level: "warning", message: `Missing ${p}`, path: p });
    }
  }

  const newRoot = path.join(projectDir, DEFAULT_ROOT_DIR);
  const legacyRoot = path.join(projectDir, LEGACY_ROOT_DIR);
  if (!(await exists(newRoot)) && (await exists(legacyRoot))) {
    issues.push({
      level: "warning",
      message: `Legacy folder detected. Consider migrating ${LEGACY_ROOT_DIR}/ to ${DEFAULT_ROOT_DIR}/`,
      path: LEGACY_ROOT_DIR,
    });
  }

  // ---- OpenSpec CLI enriched validation (when available) ----
  const bridgeResult = await openspec.validate(projectDir);
  if (bridgeResult.bridged && bridgeResult.data) {
    const { report } = bridgeResult.data;
    for (const item of report.items) {
      for (const issue of item.issues) {
        issues.push({
          level: mapLevel(issue.level),
          message: `[openspec] ${item.type}/${item.id}: ${issue.message}`,
          path: issue.path ?? `openspec/${item.type === "change" ? "changes" : "specs"}/${item.id}`,
        });
      }
    }
  }

  return issues;
}