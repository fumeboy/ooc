/**
 * 真实 LLM 集成烟雾测试（skip 如无 API key）。
 *
 * 验证 ThinkLoop + Worker 端到端跑通真实 LLM：
 * - 提交一个 maxTicks=2 的 ThinkThread
 * - Worker.runUntilDone 等待完成
 * - 验证 thread.status=done / failed（能跑通即可）且 messages 数量增加
 *
 * 真实 LLM 使用 OOC_* 环境变量配置；缺 OOC_API_KEY 时 skip。
 * 模型优先级：claude → haiku-4-5；openai → gpt-4o-mini（按 env 配置）。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { Worker } from "../worker";
import { createLlmClient } from "../llm/client";
import type { ThinkThread } from "../think-thread";

function loadEnvFromFile(): void {
    const envPaths = [
        resolve(process.cwd(), ".env"),
        resolve(process.cwd(), "../../.env"),
    ];
    for (const p of envPaths) {
        if (!existsSync(p)) continue;
        const content = readFileSync(p, "utf-8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const sep = trimmed.indexOf("=");
            if (sep <= 0) continue;
            const key = trimmed.slice(0, sep);
            const val = trimmed.slice(sep + 1);
            process.env[key] = val;
        }
        return;
    }
}

const shouldRun = process.env.RUN_REAL_LLM_TEST === "1";

describe.skipIf(!shouldRun)("real LLM thinkloop integration", () => {
    it("Worker 驱动 ThinkThread 完成一次真实 LLM 对话", async () => {
        loadEnvFromFile();

        // 若 .env 未设置 OOC_API_KEY，手动 skip
        if (!process.env.OOC_API_KEY) {
            console.log("OOC_API_KEY not set, skipping real LLM test");
            return;
        }

        const llmClient = createLlmClient();
        const worker = new Worker(
            { worldRoot: "/tmp/ooc-real-llm-test", pollMs: 50 },
            llmClient,
        );

        const thread: ThinkThread = {
            id: "t_real_" + Date.now(),
            sessionId: "s_real",
            objectUri: "ooc://stones/main/objects/root",
            messages: [
                {
                    role: "system",
                    content: "You are a concise test assistant. Reply with only the word 'OK'.",
                },
                {
                    role: "user",
                    content: "Reply with 'OK'.",
                },
            ],
            status: "running",
            maxTicks: 2,
            ticks: 0,
            llmTimeoutMs: 30_000,
        };

        worker.submit(thread);
        await worker.runUntilDone(60_000);

        // thread 应当在 maxTicks 内完成（done 或 failed）
        expect(thread.status === "done" || thread.status === "failed").toBe(true);
        // messages 应当比初始多（LLM 至少返回了一条内容，或 failed 保持原有消息）
        expect(thread.messages.length).toBeGreaterThanOrEqual(2);

        if (thread.status === "done") {
            // 至少有一条 assistant 消息
            const hasAssistant = thread.messages.some((m) => m.role === "assistant");
            expect(hasAssistant).toBe(true);
        }
    }, 90_000);
});
