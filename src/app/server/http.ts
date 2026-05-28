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
 * Worker 由调用方（server entrypoint）传入；HTTP 层不构建 LlmClient。
 */

import Elysia from "elysia";
import { shortId } from "@src/persistable/flow-paths";
import { Worker } from "@src/thinkable/worker";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import { invokeMethod } from "@src/executable/dispatcher";
import type { ThinkThread } from "@src/thinkable/think-thread";

export interface HttpDeps {
    worker: Worker;
}

/**
 * 构建 Elysia app（不 listen，方便测试用 app.handle()）。
 */
export function buildApp(deps: HttpDeps): Elysia {
    const app = new Elysia();
    const { worker } = deps;

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
