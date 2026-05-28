/**
 * HTTP 控制面 (Elysia)。
 *
 * P6 最小 API 集合：
 *
 *   POST /api/sessions                 创建 session + 提交 root thread 到 worker
 *   GET  /api/sessions/:sessionId      查询 session 状态（线程快照）
 *   POST /api/sessions/:sessionId/invoke  直接调 method（不经 LLM）
 *   GET  /api/health                   健康检查
 *
 * P7 追加（spec §3.2 / §5.1）：
 *
 *   POST /api/talk                     user→target 直投 talk；唤起 target LLM；返回 LLM 响应
 *
 * Worker 由调用方（server entrypoint）传入；HTTP 层不构建 LlmClient。
 */

import Elysia from "elysia";
import { appendTalkEntry, shortId } from "@src/persistable/flow-paths";
import { Worker } from "@src/thinkable/worker";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import { invokeMethod } from "@src/executable/dispatcher";
import type { ThinkThread } from "@src/thinkable/think-thread";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface HttpDeps {
    worker: Worker;
    /**
     * 预构建的 Object registry（由调用方传入，与 Worker 共享同一实例）。
     * 当 /api/talk 等端点需要查找 Object 时使用，避免从 worldRoot 重新扫描。
     * 若不传，相关端点会尝试从 worker.worldRoot 扫描（仅在 stones 在 worldRoot 下时有效）。
     */
    registry?: ObjectRegistry;
}

/**
 * 构建 Elysia app（不 listen，方便测试用 app.handle()）。
 */
export function buildApp(deps: HttpDeps): Elysia {
    const app = new Elysia();
    const { worker } = deps;
    const sharedRegistry = deps.registry;

    /* -------- health -------- */

    app.get("/api/health", () => ({
        ok: true,
        worldRoot: worker.worldRoot,
    }));

    /* -------- sessions -------- */

    /**
     * POST /api/sessions
     * body: { objectUri: string; systemPrompt?: string; maxTicks?: number }
     *
     * 创建 session、提交 ThinkThread 到 worker queue、返回 sessionId + threadId。
     */
    app.post("/api/sessions", async ({ body }) => {
        const b = body as Record<string, unknown>;
        const objectUri = typeof b?.objectUri === "string" ? b.objectUri : undefined;
        if (!objectUri) {
            return new Response(
                JSON.stringify({ ok: false, error: "objectUri required" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        const sessionId = shortId("ses");
        const threadId = shortId("t");
        const maxTicks = typeof b?.maxTicks === "number" ? b.maxTicks : 10;
        const systemPrompt = typeof b?.systemPrompt === "string"
            ? b.systemPrompt
            : `You are an OOC Object at ${objectUri}. Complete your task and stop.`;

        const thread: ThinkThread = {
            id: threadId,
            sessionId,
            objectUri,
            messages: [
                { role: "system", content: systemPrompt },
            ],
            status: "running",
            maxTicks,
            ticks: 0,
        };

        worker.submit(thread);

        return {
            ok: true,
            sessionId,
            threadId,
        };
    });

    /**
     * GET /api/sessions/:sessionId
     *
     * 返回 sessionId 下所有 thread 的快照。
     */
    app.get("/api/sessions/:sessionId", ({ params }) => {
        const { sessionId } = params;
        const threads = worker.list().filter((t) => t.sessionId === sessionId);
        return {
            ok: true,
            sessionId,
            threads: threads.map((t) => ({
                id: t.id,
                objectUri: t.objectUri,
                status: t.status,
                ticks: t.ticks,
                maxTicks: t.maxTicks,
                lastError: t.lastError,
                messageCount: t.messages.length,
            })),
        };
    });

    /**
     * GET /api/threads/:threadId
     *
     * 按 threadId 查单个 thread（含消息列表）。
     */
    app.get("/api/threads/:threadId", ({ params }) => {
        const { threadId } = params;
        const thread = worker.get(threadId);
        if (!thread) {
            return new Response(
                JSON.stringify({ ok: false, error: "thread not found" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }
        return { ok: true, thread };
    });

    /**
     * POST /api/sessions/:sessionId/invoke
     * body: { objectUri: string; method: string; args?: unknown }
     *
     * 直接调用 Object method（不经过 LLM 调度）——用于控制面操作 / 测试。
     * 加载 world 目录下的 Object、调用指定 method、返回结果。
     */
    app.post("/api/sessions/:sessionId/invoke", async ({ params, body }) => {
        const { sessionId } = params;
        const b = body as Record<string, unknown>;
        const objectUri = typeof b?.objectUri === "string" ? b.objectUri : undefined;
        const method = typeof b?.method === "string" ? b.method : undefined;

        if (!objectUri || !method) {
            return new Response(
                JSON.stringify({ ok: false, error: "objectUri and method required" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        try {
            const registry = new ObjectRegistry();
            const records = await loadObjects({
                worldRoot: worker.worldRoot,
                branch: "main",
                sessionId,
            });
            for (const r of records) {
                registry.set(r);
            }

            const ctx = {
                worldRoot: worker.worldRoot,
                sessionId,
                registry,
            };

            const result = await invokeMethod(registry, objectUri, method, b.args ?? {}, ctx);
            return { ok: true, result };
        } catch (error) {
            return new Response(
                JSON.stringify({ ok: false, error: (error as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
    });

    /**
     * POST /api/talk
     * body: { target: string; content: string; sessionId?: string }
     *
     * spec §3.2 / §5.1: user 直投 talk → target Object 被唤起 → LLM 思考 → 返回 LLM 响应。
     *
     * 流程：
     * 1. 使用 userUri = "ooc://users/me" 作为 sender
     * 2. 将 content 以 direction=in 写入 target 的 talks/<user>.jsonl
     * 3. 为 target 创建 ThinkThread，以 in-talk 作为上下文注入
     * 4. 提交 worker 并 runUntilDone
     * 5. 从 target 的 talks/<user>.jsonl 读取最新 out 消息作为 response
     */
    app.post("/api/talk", async ({ body }) => {
        const b = body as Record<string, unknown>;
        const targetUri = typeof b?.target === "string" ? b.target : undefined;
        const content = typeof b?.content === "string" ? b.content : undefined;

        if (!targetUri || !content) {
            return new Response(
                JSON.stringify({ ok: false, error: "target (string) and content (string) required" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        const sessionId = typeof b?.sessionId === "string" ? b.sessionId : shortId("ses");
        const userUri = "ooc://users/me";
        const targetName = targetUri.split("/").pop()!;
        const ts = new Date().toISOString();

        try {
            // 1. Build registry for this session
            //    If a shared registry was provided at buildApp time, reuse it (contains builtins).
            //    Otherwise fall back to scanning worker.worldRoot (works when stones are co-located).
            let registry: ObjectRegistry;
            if (sharedRegistry) {
                // Reuse shared registry; also load any ephemeral flow objects created in this session
                registry = sharedRegistry;
                const flowRecords = await loadObjects({
                    worldRoot: worker.worldRoot,
                    sessionId,
                });
                for (const r of flowRecords) {
                    if (r.kind === "ephemeral") registry.set(r);
                }
            } else {
                registry = new ObjectRegistry();
                const records = await loadObjects({
                    worldRoot: worker.worldRoot,
                    branch: "main",
                    sessionId,
                });
                for (const r of records) {
                    registry.set(r);
                }
            }

            // Verify target Object exists
            const targetRecord = registry.get(targetUri);
            if (!targetRecord) {
                return new Response(
                    JSON.stringify({ ok: false, error: `target Object not found: ${targetUri}` }),
                    { status: 404, headers: { "Content-Type": "application/json" } },
                );
            }

            // 2. Append in-talk to target's talks file (direction=in from user)
            await appendTalkEntry(worker.worldRoot, sessionId, targetName, {
                ts,
                direction: "in",
                peer: userUri,
                content,
            });

            // 3. Create ThinkThread for target with the in-talk as initial user message
            const threadId = shortId("t");
            const thread: ThinkThread = {
                id: threadId,
                sessionId,
                objectUri: targetUri,
                messages: [
                    {
                        role: "system",
                        content: `You are an OOC Object at ${targetUri}. A user has sent you a message via talk. Respond to the user's message using your available methods, then call talk() to send your response back to the user (target: "${userUri}"). When done, stop responding.`,
                    },
                    {
                        role: "user",
                        content: `[talk from ${userUri}]\n${content}\n[/talk]`,
                    },
                ],
                status: "running",
                maxTicks: typeof b?.maxTicks === "number" ? b.maxTicks : 5,
                ticks: 0,
                llmTimeoutMs: 60_000,
            };

            // 4. Submit and run worker until done
            worker.submit(thread);
            await worker.runUntilDone(90_000);

            // 5. Read target's talks file for latest out message (response to user)
            const talksDir = path.join(worker.worldRoot, "flows", sessionId, "objects", targetName, "talks");
            const userSlug = userUri.replace(/^ooc:\/\//, "").replace(/\//g, "__");
            const talksFile = path.join(talksDir, `${userSlug}.jsonl`);
            let response: string | undefined;
            try {
                const raw = await fs.readFile(talksFile, "utf8");
                const lines = raw.trim().split("\n").filter(Boolean);
                // Find last out message
                for (let i = lines.length - 1; i >= 0; i--) {
                    const entry = JSON.parse(lines[i]!) as { direction: string; content: string };
                    if (entry.direction === "out") {
                        response = entry.content;
                        break;
                    }
                }
            } catch {
                // No talks file yet — target LLM may not have called talk() back
            }

            // If no talk-back found, check thread's final assistant message as fallback
            if (!response) {
                const lastAssistant = [...thread.messages].reverse().find((m) => m.role === "assistant");
                response = lastAssistant?.content as string | undefined;
            }

            return {
                ok: true,
                sessionId,
                threadId,
                response: response ?? "",
                threadStatus: thread.status,
            };
        } catch (error) {
            return new Response(
                JSON.stringify({ ok: false, error: (error as Error).message }),
                { status: 500, headers: { "Content-Type": "application/json" } },
            );
        }
    });

    return app;
}

/**
 * 启动 HTTP 服务器。
 *
 * @param deps - Worker 实例
 * @param port - 监听端口，默认 3000
 */
export function startHttpServer(deps: HttpDeps, port = 3000): Elysia {
    const app = buildApp(deps);
    app.listen(port);
    return app;
}
