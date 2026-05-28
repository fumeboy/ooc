/**
 * tests/e2e/code-agent-real-llm.test.ts
 *
 * code-agent A 类 method 真实 LLM e2e 验证（P6d milestone）。
 *
 * 验证链路：用户给文件读+pattern匹配+写文件任务 → ThinkThread → Worker → LLM tool calls
 *           → grep / open_file / write_file 执行 → 文件落盘验证
 *
 * 跳过条件：ANTHROPIC_API_KEY 未设置。
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=<key> bun test tests/e2e/code-agent-real-llm.test.ts
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

describe.skipIf(!hasApiKey)("code-agent real-LLM e2e (P6d milestone)", () => {
    test(
        "agent reads file, finds pattern, writes new file",
        async () => {
            ensureClaudeEnv();
            const worldRoot = mkdtempSync(join(tmpdir(), "ooc-code-agent-"));
            const sessionId = `_test_code_${Date.now()}`;

            // Seed a small sample file for the agent to read
            mkdirSync(join(worldRoot, "data"), { recursive: true });
            writeFileSync(join(worldRoot, "data", "sample.txt"),
                "apple\nbanana\ncherry\napricot\nblueberry\n");

            // Load root prototype from project (real builtin stones)
            const registry = new ObjectRegistry();
            const records = await loadObjects({ worldRoot: process.cwd() });
            for (const r of records) registry.set(r);
            const root = records.find(r => r.uri.includes("/objects/root"))!;
            expect(root).toBeDefined();

            const llmClient = createLlmClient();
            const worker = new Worker({ worldRoot, pollMs: 50 }, llmClient, registry);

            const thread: ThinkThread = {
                id: `t_code_${Date.now()}`,
                sessionId,
                objectUri: root.uri,
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are a code agent with these tools: grep, glob, open_file, write_file.",
                            "Use them to complete the task. Keep responses concise.",
                            "Paths are relative to or under the world root.",
                            `The world root for this session is: ${worldRoot}`,
                        ].join("\n"),
                    },
                    {
                        role: "user",
                        content: [
                            `World root for this task: ${worldRoot}`,
                            `The file to read is: ${join(worldRoot, "data", "sample.txt")}`,
                            "Task: read data/sample.txt (use open_file with the full absolute path above),",
                            "find all lines starting with the letter 'a',",
                            `and write them to ${join(worldRoot, "data", "found-a.txt")} (one per line).`,
                            "After done, briefly say what you did.",
                        ].join("\n"),
                    },
                ],
                status: "running",
                maxTicks: 8,
                ticks: 0,
                llmTimeoutMs: 60_000,
            };

            worker.submit(thread);
            await worker.runUntilDone(120_000);

            expect(thread.status).toBe("done");
            const lastAssistant = [...thread.messages].reverse().find(m => m.role === "assistant");
            console.log("[code-agent-real] LLM final response:", lastAssistant?.content?.slice(0, 400));

            // Verify the output file was created
            const outputPath = join(worldRoot, "data", "found-a.txt");
            expect(existsSync(outputPath)).toBe(true);
            const body = readFileSync(outputPath, "utf8");
            // Should contain "apple" and "apricot"
            expect(body.toLowerCase()).toContain("apple");
            expect(body.toLowerCase()).toContain("apricot");
            // Should NOT contain banana/cherry (don't start with a)
            expect(body.toLowerCase()).not.toContain("banana");
        },
        120_000,
    );
});
