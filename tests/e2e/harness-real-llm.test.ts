/**
 * tests/e2e/harness-real-llm.test.ts
 *
 * Harness 真实 LLM e2e 验证（P6b milestone）。
 *
 * 验证链路：用户消息 → ThinkThread → Worker → LLM tool call → dispatcher.invokeMethod
 *           → todo_add 落盘 → thread.status=done
 *
 * 跳过条件：ANTHROPIC_API_KEY 未设置。
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=<key> OOC_PROVIDER=claude OOC_BASE_URL=https://api.anthropic.com OOC_MODEL=claude-haiku-4-5 \
 *   bun test tests/e2e/harness-real-llm.test.ts
 */

import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { Worker } from "@src/thinkable/worker";
import { createLlmClient } from "@src/thinkable/llm/client";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import type { ThinkThread } from "@src/thinkable/think-thread";

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Ensure OOC_* env vars are set so createLlmClient() won't throw.
 * Defaults to Claude claude-haiku-4-5 if not specified.
 */
function ensureClaudeEnv(): void {
    if (!process.env.OOC_PROVIDER) {
        process.env.OOC_PROVIDER = "claude";
    }
    if (!process.env.OOC_API_KEY) {
        process.env.OOC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
    }
    if (!process.env.OOC_BASE_URL) {
        process.env.OOC_BASE_URL = "https://api.anthropic.com";
    }
    if (!process.env.OOC_MODEL) {
        process.env.OOC_MODEL = "claude-haiku-4-5";
    }
}

describe.skipIf(!hasApiKey)("harness real-LLM e2e (P6b milestone)", () => {
    test(
        "echo_agent: 真实 LLM 发出 todo_add tool call → 落盘验证",
        async () => {
            ensureClaudeEnv();

            // 1. Create temp world (flows will be written here)
            const worldRoot = mkdtempSync(join(tmpdir(), "ooc-e2e-harness-"));
            const sessionId = `_test_harness_${Date.now()}`;

            // 2. Load root prototype from the project's builtin stones
            //    loadObjects looks for worldRoot/stones/_builtin/objects/
            const projectRoot = process.cwd();
            const registry = new ObjectRegistry();
            const records = await loadObjects({ worldRoot: projectRoot });
            for (const r of records) {
                registry.set(r);
            }

            const rootRecord = records.find((r) => r.uri.includes("/objects/root"));
            expect(rootRecord).toBeDefined();
            const objectUri = rootRecord!.uri;

            // 3. Build LLM client (uses real Anthropic API via OOC_* env vars)
            const llmClient = createLlmClient();

            // 4. Build Worker with the registry
            const worker = new Worker(
                { worldRoot, pollMs: 50 },
                llmClient,
                registry,
            );

            // 5. Create ThinkThread for echo_agent
            //    System prompt instructs the model to call todo_add with "buy milk"
            const thread: ThinkThread = {
                id: `t_harness_${Date.now()}`,
                sessionId,
                objectUri,
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are a helpful assistant with access to the todo_add tool.",
                            "When asked to add a todo, call the todo_add tool with the content parameter.",
                            "After calling the tool, confirm what you did in a short sentence.",
                            "",
                            "Available tool: todo_add(content: string) — adds a todo item.",
                        ].join("\n"),
                    },
                    {
                        role: "user",
                        content: "Please add a todo: 'buy milk', then say what you did.",
                    },
                ],
                status: "running",
                maxTicks: 5,
                ticks: 0,
                llmTimeoutMs: 60_000,
            };

            // 6. Submit and run
            worker.submit(thread);
            await worker.runUntilDone(60_000);

            // 7. Verify: thread completed
            expect(thread.status).toBe("done");
            expect(thread.messages.length).toBeGreaterThan(0);

            // 8. Verify: LLM produced some response text
            const assistantMessages = thread.messages.filter((m) => m.role === "assistant");
            expect(assistantMessages.length).toBeGreaterThan(0);
            const llmText = assistantMessages[assistantMessages.length - 1]!.content;
            console.log("[harness-real-llm] LLM response (first 200):", llmText.slice(0, 200));

            // 9. Verify: todos.json exists and contains "buy milk"
            //    nameFromUri("ooc://stones/_builtin/objects/root") → "root"
            const objectName = objectUri.split("/").pop()!;
            const todosPath = join(worldRoot, "flows", sessionId, "objects", objectName, "todos.json");
            expect(existsSync(todosPath)).toBe(true);
            const todosRaw = readFileSync(todosPath, "utf-8");
            const todos = JSON.parse(todosRaw) as { items: Array<{ content: string }> };
            const hasBuyMilk = todos.items.some((it) =>
                it.content.toLowerCase().includes("buy milk"),
            );
            expect(hasBuyMilk).toBe(true);
        },
        60_000,
    );
});
