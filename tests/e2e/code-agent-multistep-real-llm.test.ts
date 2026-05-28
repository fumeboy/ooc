/**
 * tests/e2e/code-agent-multistep-real-llm.test.ts
 *
 * 多步 code-agent 真实 LLM e2e（P6e milestone）。
 *
 * 验证链路：用户给多步任务 → LLM 依次调用 write_file → exec_command → 汇报输出
 *
 * 跳过条件：ANTHROPIC_API_KEY 未设置。
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=<key> bun test tests/e2e/code-agent-multistep-real-llm.test.ts
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "@src/thinkable/worker";
import { createLlmClient } from "@src/thinkable/llm/client";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import type { ThinkThread } from "@src/thinkable/think-thread";

const hasApiKey = Boolean(process.env.OOC_API_KEY || process.env.ANTHROPIC_API_KEY);

function ensureClaudeEnv() {
    if (!process.env.OOC_PROVIDER) process.env.OOC_PROVIDER = "claude";
    if (!process.env.OOC_API_KEY) process.env.OOC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
    if (!process.env.OOC_BASE_URL) process.env.OOC_BASE_URL = "https://api.anthropic.com";
    if (!process.env.OOC_MODEL) process.env.OOC_MODEL = "claude-haiku-4-5";
}

describe.skipIf(!hasApiKey)("multi-step code-agent real-LLM e2e", () => {
    test(
        "agent: write script → exec → read output → summarize",
        async () => {
            ensureClaudeEnv();
            const worldRoot = mkdtempSync(join(tmpdir(), "ooc-multistep-"));
            const sessionId = `_test_multistep_${Date.now()}`;

            const registry = new ObjectRegistry();
            const records = await loadObjects({ worldRoot: process.cwd() });
            for (const r of records) registry.set(r);
            const root = records.find(r => r.uri.includes("/objects/root"))!;
            expect(root).toBeDefined();

            const llmClient = createLlmClient();
            const worker = new Worker({ worldRoot, pollMs: 50 }, llmClient, registry);

            const thread: ThinkThread = {
                id: `t_multistep_${Date.now()}`,
                sessionId,
                objectUri: root.uri,
                messages: [
                    {
                        type: "message" as const,
                        role: "system" as const,
                        content: [
                            "You are a code agent. You have tools: write_file, exec_command, open_file, grep, glob.",
                            "Task: complete what the user asks step by step using tools. Be efficient.",
                            "When done, briefly say what you accomplished.",
                        ].join("\n"),
                    },
                    {
                        type: "message" as const,
                        role: "user" as const,
                        content: [
                            `Your working directory: ${worldRoot}`,
                            "Task:",
                            `1. Write a small shell script at ${join(worldRoot, "counter.sh")} that echoes the numbers 1 to 5, each on its own line.`,
                            `2. Execute it via exec_command (use command: ["bash", "${join(worldRoot, "counter.sh")}"] ).`,
                            "3. Tell me what the output was.",
                        ].join("\n"),
                    },
                ],
                status: "running",
                maxTicks: 10,
                ticks: 0,
                llmTimeoutMs: 60_000,
            };

            worker.submit(thread);
            await worker.runUntilDone(180_000);

            expect(thread.status).toBe("done");
            const lastAssistant = [...thread.messages].reverse().find(
                m => m.type === "message" && (m as { type: string; role: string }).role === "assistant"
            );
            const lastContent = lastAssistant && "content" in lastAssistant ? (lastAssistant as { content: string }).content : "";
            console.log("[multistep-e2e] LLM final:", lastContent?.slice(0, 500));

            // Verify: counter.sh exists
            const scriptPath = join(worldRoot, "counter.sh");
            expect(existsSync(scriptPath)).toBe(true);

            // Verify: LLM final answer mentions the numbers 1 and 5
            const finalText = lastContent?.toLowerCase() ?? "";
            const hasNumber1 = finalText.includes("1");
            const hasNumber5 = finalText.includes("5");
            expect(hasNumber1 && hasNumber5).toBe(true);
        },
        180_000,
    );
});
