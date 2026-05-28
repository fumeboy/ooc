/**
 * tests/e2e/bug-fix-real-llm.test.ts
 *
 * 真实 LLM bug-fix 场景 e2e（P6f milestone）。
 *
 * 验证链路：LLM agent 自主发现并修复 off-by-one bug，运行 bun test 确认修复。
 *
 * 跳过条件：ANTHROPIC_API_KEY 未设置。
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=<key> bun test tests/e2e/bug-fix-real-llm.test.ts
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "@src/thinkable/worker";
import { createLlmClient } from "@src/thinkable/llm/client";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import type { ThinkThread } from "@src/thinkable/think-thread";

const hasApiKey = Boolean(process.env.OOC_API_KEY || process.env.ANTHROPIC_API_KEY);

const BUGGY_MATH_TS = `export function sumTo(n: number): number {
    // bug: should be i <= n, but uses i < n
    let total = 0;
    for (let i = 1; i < n; i++) total += i;
    return total;
}
`;

const MATH_TEST_TS = `import { describe, expect, test } from "bun:test";
import { sumTo } from "./math";

describe("sumTo", () => {
    test("sumTo(5) === 15", () => {
        expect(sumTo(5)).toBe(15);
    });
    test("sumTo(10) === 55", () => {
        expect(sumTo(10)).toBe(55);
    });
});
`;

function ensureClaudeEnv() {
    if (!process.env.OOC_PROVIDER) process.env.OOC_PROVIDER = "claude";
    if (!process.env.OOC_API_KEY) process.env.OOC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
    if (!process.env.OOC_BASE_URL) process.env.OOC_BASE_URL = "https://api.anthropic.com";
    if (!process.env.OOC_MODEL) process.env.OOC_MODEL = "claude-haiku-4-5";
}

describe.skipIf(!hasApiKey)("bug-fix real-LLM e2e (P6f milestone)", () => {
    test(
        "agent finds off-by-one bug in math.ts, fixes it, and confirms tests pass",
        async () => {
            ensureClaudeEnv();
            const worldRoot = mkdtempSync(join(tmpdir(), "ooc-bugfix-"));
            const sessionId = `_test_bugfix_${Date.now()}`;

            // Write buggy source and failing tests into temp dir
            writeFileSync(join(worldRoot, "math.ts"), BUGGY_MATH_TS);
            writeFileSync(join(worldRoot, "math.test.ts"), MATH_TEST_TS);

            // Pre-verify: bun test should fail before the fix
            const beforeProc = Bun.spawnSync({
                cmd: ["bun", "test", "math.test.ts"],
                cwd: worldRoot,
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(beforeProc.exitCode).not.toBe(0);

            // Load root object prototype from builtin stones
            const registry = new ObjectRegistry();
            const records = await loadObjects({ worldRoot: process.cwd() });
            for (const r of records) registry.set(r);
            const root = records.find(r => r.uri.includes("/objects/root"))!;
            expect(root).toBeDefined();

            const llmClient = createLlmClient();
            const worker = new Worker({ worldRoot, pollMs: 50 }, llmClient, registry);

            const thread: ThinkThread = {
                id: `t_bugfix_${Date.now()}`,
                sessionId,
                objectUri: root.uri,
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are a code agent. You have tools: grep, glob, open_file, write_file, exec_command.",
                            "Work iteratively: read source files, understand the bug, fix it, run tests to verify.",
                            "Use exec_command to run `bun test math.test.ts` in the working directory to check if tests pass.",
                            "Keep going until all tests pass.",
                            "When tests pass, say 'All tests pass' briefly.",
                        ].join("\n"),
                    },
                    {
                        role: "user",
                        content: [
                            `Working directory: ${worldRoot}`,
                            `There is a bug in ${join(worldRoot, "math.ts")}. The tests in ${join(worldRoot, "math.test.ts")} fail.`,
                            `Run the tests first with exec_command using cwd "${worldRoot}" and cmd ["bun", "test", "math.test.ts"] to see the failures.`,
                            "Then open math.ts to find the bug, fix it with write_file, and run tests again to confirm the fix.",
                            "When tests pass, say 'All tests pass' briefly.",
                        ].join("\n"),
                    },
                ],
                status: "running",
                maxTicks: 15,
                ticks: 0,
                llmTimeoutMs: 60_000,
            };

            worker.submit(thread);
            await worker.runUntilDone(300_000);

            console.log("[bug-fix-e2e] thread status:", thread.status);
            console.log("[bug-fix-e2e] total messages:", thread.messages.length);

            // Log all tool calls for tracing (tool results appended as user messages with [tool_result ...] prefix)
            const toolResultMsgs = thread.messages.filter(
                m => m.role === "user" && m.content.startsWith("[tool_result")
            );
            const toolsUsed = toolResultMsgs.map(m => {
                const match = /name="([^"]+)"/.exec(m.content);
                return match ? match[1] : "unknown";
            });
            console.log("[bug-fix-e2e] tool calls:", toolResultMsgs.length, "tools used:", toolsUsed.join(", "));

            const lastAssistant = [...thread.messages].reverse().find(m => m.role === "assistant");
            console.log("[bug-fix-e2e] LLM final:", lastAssistant?.content?.slice(0, 500));

            expect(thread.status).toBe("done");

            // 1. math.ts content must have been fixed (no longer contains the bug)
            const fixedContent = readFileSync(join(worldRoot, "math.ts"), "utf8");
            expect(fixedContent).not.toContain("i < n");
            expect(fixedContent).toContain("i <= n");

            // 2. bun test must now pass
            const afterProc = Bun.spawnSync({
                cmd: ["bun", "test", "math.test.ts"],
                cwd: worldRoot,
                stdout: "pipe",
                stderr: "pipe",
            });
            console.log("[bug-fix-e2e] post-fix test exit:", afterProc.exitCode);
            console.log("[bug-fix-e2e] post-fix stderr:", afterProc.stderr?.toString().slice(0, 300));
            expect(afterProc.exitCode).toBe(0);

            // 3. LLM final response should indicate success
            const text = lastAssistant?.content?.toLowerCase() ?? "";
            expect(text.includes("pass") || text.includes("fix")).toBe(true);
        },
        300_000,
    );
});
