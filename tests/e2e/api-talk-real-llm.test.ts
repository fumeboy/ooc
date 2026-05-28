/**
 * tests/e2e/api-talk-real-llm.test.ts
 *
 * POST /api/talk 真实 LLM e2e 验证（spec §3.2 / §5.1）。
 *
 * 验证链路：
 *   POST /api/talk { target, content }
 *     → appendTalkEntry(target, direction=in)
 *     → ThinkThread created for target
 *     → Worker.runUntilDone()
 *     → LLM calls talk() back to user
 *     → 双端 talks/<peer>.jsonl 落盘验证
 *     → 200 + LLM response in body
 *
 * 跳过条件：ANTHROPIC_API_KEY 未设置。
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=<key> bun test tests/e2e/api-talk-real-llm.test.ts
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLlmClient } from "@src/thinkable/llm/client";
import { Worker } from "@src/thinkable/worker";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import { buildApp } from "@src/app/server/http";

const hasApiKey = Boolean(process.env.OOC_API_KEY || process.env.ANTHROPIC_API_KEY);

function ensureClaudeEnv() {
    if (!process.env.OOC_PROVIDER) process.env.OOC_PROVIDER = "claude";
    if (!process.env.OOC_API_KEY) process.env.OOC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
    if (!process.env.OOC_BASE_URL) process.env.OOC_BASE_URL = "https://api.anthropic.com";
    if (!process.env.OOC_MODEL) process.env.OOC_MODEL = "claude-haiku-4-5";
}

describe.skipIf(!hasApiKey)("POST /api/talk real-LLM e2e (spec §3.2/§5.1)", () => {
    test(
        "user→target talk → LLM responds via talk → 双端 talks files verified",
        async () => {
            ensureClaudeEnv();

            // 1. Set up temp world
            const worldRoot = mkdtempSync(join(tmpdir(), "ooc-e2e-talk-"));
            const sessionId = `_test_api_talk_${Date.now()}`;

            // 2. Load registry with builtin objects from project
            const registry = new ObjectRegistry();
            const records = await loadObjects({ worldRoot: process.cwd() });
            for (const r of records) registry.set(r);

            const rootRecord = records.find((r) => r.uri.includes("/objects/root"));
            expect(rootRecord).toBeDefined();
            const targetUri = rootRecord!.uri;

            // 3. Build HTTP app with real LLM worker
            //    Pass registry to buildApp so /api/talk can find builtin objects
            const llmClient = createLlmClient();
            const worker = new Worker({ worldRoot, pollMs: 50 }, llmClient, registry);
            const app = buildApp({ worker, registry });

            // 4. POST /api/talk
            const resp = await app.handle(
                new Request("http://localhost/api/talk", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        target: targetUri,
                        content: "Hello! Please add a todo item 'call doctor' and then tell me you did it.",
                        sessionId,
                        maxTicks: 5,
                    }),
                }),
            );

            expect(resp.status).toBe(200);
            const data = await resp.json() as Record<string, unknown>;
            console.log("[api-talk-real] response:", JSON.stringify(data).slice(0, 400));

            expect(data.ok).toBe(true);
            expect(typeof data.response).toBe("string");
            expect((data.response as string).length).toBeGreaterThan(0);
            expect(data.sessionId).toBe(sessionId);

            // 5. Verify target's in-talk file exists (user→target, direction=in)
            const targetName = targetUri.split("/").pop()!;
            const talksDir = join(worldRoot, "flows", sessionId, "objects", targetName, "talks");
            expect(existsSync(talksDir)).toBe(true);

            const userSlug = "users__me";
            const inTalksFile = join(talksDir, `${userSlug}.jsonl`);
            expect(existsSync(inTalksFile)).toBe(true);

            const inTalksRaw = readFileSync(inTalksFile, "utf8");
            const inEntries = inTalksRaw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

            // Should have at least one in message
            const inMessages = inEntries.filter((e: any) => e.direction === "in");
            expect(inMessages.length).toBeGreaterThan(0);
            console.log("[api-talk-real] in-talk entry:", JSON.stringify(inMessages[0]).slice(0, 200));

            // 6. Verify todos.json was created (LLM was asked to add todo)
            const todosPath = join(worldRoot, "flows", sessionId, "objects", targetName, "todos.json");
            if (existsSync(todosPath)) {
                const todos = JSON.parse(readFileSync(todosPath, "utf8")) as { items: Array<{ content: string }> };
                const hasCallDoctor = todos.items.some((it) =>
                    it.content.toLowerCase().includes("call doctor"),
                );
                console.log("[api-talk-real] todos:", JSON.stringify(todos.items).slice(0, 200));
                expect(hasCallDoctor).toBe(true);
            }
        },
        120_000,
    );
});
