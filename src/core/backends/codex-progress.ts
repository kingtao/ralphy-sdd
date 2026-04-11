/**
 * Codex JSONL progress event handler.
 *
 * Shared between `plan` (planning pipeline) and `run` (codex backend).
 * Parses codex JSONL events and emits filtered, human-readable progress lines.
 *
 * Codex event format:
 *   { type: "thread.started", thread_id: "..." }
 *   { type: "turn.started" }
 *   { type: "item.started", item: { id, type, ... } }
 *   { type: "item.completed", item: { id, type, text?, changes?, command?, status? } }
 *   { type: "turn.completed", usage: { input_tokens, output_tokens, ... } }
 */

export type ProgressCtx = {
    getToolCallCount: () => number;
    incToolCallCount: () => void;
    getFileWriteCount: () => number;
    incFileWriteCount: () => void;
    getLastActivity: () => string;
    setLastActivity: (a: string) => void;
};

export function createProgressCtx(): ProgressCtx & {
    toolCallCount: number;
    fileWriteCount: number;
} {
    const state = { toolCallCount: 0, fileWriteCount: 0, lastActivity: "" };
    return {
        get toolCallCount() { return state.toolCallCount; },
        get fileWriteCount() { return state.fileWriteCount; },
        getToolCallCount: () => state.toolCallCount,
        incToolCallCount: () => { state.toolCallCount++; },
        getFileWriteCount: () => state.fileWriteCount,
        incFileWriteCount: () => { state.fileWriteCount++; },
        getLastActivity: () => state.lastActivity,
        setLastActivity: (a: string) => { state.lastActivity = a; },
    };
}

/**
 * Handle a single codex JSONL event, emitting a filtered progress line.
 */
export function handleProgressEvent(
    event: any,
    write: (msg: string) => void,
    startTime: number,
    ctx: ProgressCtx,
): void {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const type = event.type ?? "";

    if (type === "turn.started") {
        write(`  \uD83D\uDCCB [${elapsed}s] Processing...\n`);

    } else if (type === "item.started") {
        const item = event.item ?? {};
        if (item.type === "function_call" || item.type === "tool_call") {
            ctx.incToolCallCount();
            const name = item.name ?? item.function ?? "tool";
            const args = item.arguments ?? {};
            const summary = summarizeItem(name, args);
            write(`  \uD83D\uDD27 [${elapsed}s] ${name}${summary ? `: ${summary}` : ""}\n`);
        } else if (item.type === "file_change") {
            const changes = item.changes ?? [];
            for (const c of changes) {
                ctx.incFileWriteCount();
                const kind = c.kind ?? "change";
                const filePath = c.path ?? "";
                write(`  \uD83D\uDCDD [${elapsed}s] ${kind}: ${filePath}\n`);
            }
        } else if (item.type === "exec" || item.type === "shell") {
            ctx.incToolCallCount();
            const cmd = item.command ?? item.cmd ?? "";
            const shortCmd = cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
            write(`  \uD83D\uDCBB [${elapsed}s] exec: ${shortCmd}\n`);
        }

    } else if (type === "item.completed") {
        const item = event.item ?? {};
        if (item.type === "agent_message" && item.text) {
            // Show agent's thinking/summary (truncated)
            const text = item.text.length > 120 ? item.text.slice(0, 117) + "..." : item.text;
            write(`  \uD83D\uDCA1 [${elapsed}s] ${text}\n`);
        } else if (item.type === "file_change" && item.status === "completed") {
            const changes = item.changes ?? [];
            for (const c of changes) {
                if (ctx.getLastActivity() !== c.path) {
                    ctx.incFileWriteCount();
                    write(`  \u2705 [${elapsed}s] ${c.kind ?? "wrote"}: ${c.path ?? ""}\n`);
                    ctx.setLastActivity(c.path ?? "");
                }
            }
        } else if (item.type === "function_call" || item.type === "tool_call") {
            // Tool call completed — already shown at item.started
        }

    } else if (type === "turn.completed") {
        const usage = event.usage ?? {};
        const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
        write(`  \uD83D\uDCCA [${elapsed}s] Turn done (${tokens.toLocaleString()} tokens)\n`);
    }
}

export function summarizeItem(name: string, args: any): string {
    if (typeof args === "string") return args.slice(0, 60);
    const p = args?.path ?? args?.file ?? args?.command ?? "";
    if (typeof p === "string") {
        return p.length > 60 ? p.slice(0, 57) + "..." : p;
    }
    return "";
}

/**
 * Attach JSONL progress parsing to a child process's stdout stream.
 * Returns a cleanup function (call when process ends to flush remaining buffer).
 */
export function attachJsonlProgress(
    stdout: NodeJS.ReadableStream,
    stderr: NodeJS.ReadableStream | null,
    write: (msg: string) => void,
    startTime: number,
    ctx: ProgressCtx,
): void {
    let buffer = "";

    stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const event = JSON.parse(line);
                handleProgressEvent(event, write, startTime, ctx);
            } catch {
                // Not valid JSON, skip
            }
        }
    });

    // Filter stderr — suppress known informational messages
    stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (!text) return;
        if (text.includes("Reading prompt from stdin") || text.includes("Reading additional input")) return;
        write(`  \u26A0 ${text.slice(0, 200)}\n`);
    });
}
