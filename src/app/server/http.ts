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
 * P8 追加（UX surface 补全）：
 *
 *   GET  /api/sessions                 列出所有 sessions
 *   GET  /api/stones                   列出 branch 下所有 stones
 *   GET  /api/stones/:branch/:name     stone 元数据
 *   GET  /api/stones/:branch/:name/self        self.md 内容
 *   GET  /api/stones/:branch/:name/readme      readme.md 内容
 *   GET  /api/stones/:branch/:name/server-source  server/index.ts 内容
 *   POST /api/stones/:branch/:name/call-method    调用 stone public method
 *   GET  /api/flows/:sessionId/objects             session 内 objects 列表
 *   GET  /api/flows/:sessionId/objects/:objectName  object 摘要
 *   GET  /api/flows/:sessionId/objects/:objectName/threads/:threadId  thread 状态
 *   GET  /api/tree                     文件树（worldRoot 范围内）
 *   GET  /api/file/read                读取文件内容（worldRoot 范围内）
 *   GET  /api/objects/:scope/:name/client-source-url  客户端源文件 URL
 *   GET  /api/world                    world 配置
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
import { createPauseStore, type PauseStore } from "./runtime/pause-store";
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
    /** stones branch，默认 "main" */
    branch?: string;
    /**
     * 源码仓库根目录（即 process.cwd()）。
     * 用于 /api/stones 同时列出 cwd branch stones（如 9 个 AgentOfX）。
     * 若不传，/api/stones 仅列出 worldRoot 下的 stones。
     */
    sourceCwd?: string;
    /**
     * PauseStore 实例（可选）。
     * 若不传，buildApp 内部自动创建一个新实例（仅对该 app 实例有效）。
     * server/index.ts 可传入共享实例以获得跨请求一致性。
     */
    pauseStore?: PauseStore;
}

/** 安全 sessionId 校验正则：只允许字母数字 + _ - ，最长 80 字符。 */
const SAFE_SESSION_ID = /^[a-zA-Z0-9_\-]{1,80}$/;

/**
 * 若 input 是合法 sessionId 则返回原值；字符串但不合法则抛 400 错误；
 * 非字符串或空字符串则自动生成新 id。
 */
function validateOrGenerateSessionId(input: unknown): string {
    if (typeof input === "string" && input.length > 0) {
        if (!SAFE_SESSION_ID.test(input)) {
            throw new Error(`invalid sessionId: must match ${SAFE_SESSION_ID}`);
        }
        return input;
    }
    return shortId("ses");
}

/**
 * 校验 URL-param sessionId 合法性（拒绝路径穿越等）；不合法则抛错误。
 * 与 validateOrGenerateSessionId 不同：URL-param 是必填的，不自动生成。
 */
function validateSessionIdParam(input: string, fieldName = "sessionId"): string {
    if (!SAFE_SESSION_ID.test(input)) {
        throw new Error(`invalid ${fieldName}: must match ${SAFE_SESSION_ID}`);
    }
    return input;
}

/** 安全 threadId 校验正则：形状与 sessionId 相同。 */
const SAFE_THREAD_ID = /^[a-zA-Z0-9_\-]{1,80}$/;

/**
 * 校验 URL-param threadId 合法性；不合法则抛错误。
 */
function validateThreadIdParam(input: string): string {
    if (!SAFE_THREAD_ID.test(input)) {
        throw new Error(`invalid threadId: must match ${SAFE_THREAD_ID}`);
    }
    return input;
}

/** 校验路径不跨出 worldRoot（安全边界）。 */
function safeResolvePath(worldRoot: string, relative: string): string | null {
    // 拒绝以 / 开头或含有 .. 的路径
    if (!relative || relative.startsWith("/") || relative.includes("..")) {
        return null;
    }
    const resolved = path.resolve(worldRoot, relative);
    if (!resolved.startsWith(worldRoot)) {
        return null;
    }
    return resolved;
}

/** 安全读取文件（worldRoot 范围内）；越界返回 null。 */
async function safeReadFile(
    worldRoot: string,
    relativePath: string,
    maxBytes = 1_000_000,
): Promise<{ content: string; bytes: number; truncated: boolean } | null> {
    const abs = safeResolvePath(worldRoot, relativePath);
    if (!abs) return null;
    let raw: Buffer;
    try {
        raw = await fs.readFile(abs);
    } catch {
        return null;
    }
    const truncated = raw.length > maxBytes;
    const slice = truncated ? raw.slice(0, maxBytes) : raw;
    return {
        content: slice.toString("utf8"),
        bytes: raw.length,
        truncated,
    };
}

/** 安全读取绝对路径文件（已校验在 worldRoot 内）。 */
async function readFileOrNull(abs: string): Promise<string | null> {
    try {
        return await fs.readFile(abs, "utf8");
    } catch {
        return null;
    }
}

/** 列出目录条目（不递归）。 */
async function listDir(
    dir: string,
): Promise<Array<{ name: string; type: "file" | "dir" }>> {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "dir" : "file",
        }));
    } catch {
        return [];
    }
}

/** 判断文件是否存在。 */
async function fileExists(p: string): Promise<boolean> {
    try {
        const stat = await fs.stat(p);
        return stat.isFile();
    } catch {
        return false;
    }
}

/** 判断目录是否存在。 */
async function dirExists(p: string): Promise<boolean> {
    try {
        const stat = await fs.stat(p);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

/**
 * 递归列出目录树。返回 FileTreeNode 兼容结构。
 * depth=0 时只返回当前层（非递归）；depth>0 时递归展开。
 * worldRoot 作安全边界——绝对路径不得在 worldRoot 外。
 */
interface FileTreeNode {
    name: string;
    type: "file" | "dir";
    path: string;
    children?: FileTreeNode[];
}

async function buildTree(
    abs: string,
    relativePath: string,
    depth: number,
): Promise<FileTreeNode[]> {
    try {
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const nodes: FileTreeNode[] = [];
        for (const entry of entries) {
            const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            const childAbs = path.join(abs, entry.name);
            if (entry.isDirectory()) {
                const node: FileTreeNode = { name: entry.name, type: "dir", path: childRel };
                if (depth > 0) {
                    node.children = await buildTree(childAbs, childRel, depth - 1);
                }
                nodes.push(node);
            } else {
                nodes.push({ name: entry.name, type: "file", path: childRel });
            }
        }
        return nodes;
    } catch {
        return [];
    }
}

/**
 * 构建 Elysia app（不 listen，方便测试用 app.handle()）。
 */
export function buildApp(deps: HttpDeps): Elysia {
    const app = new Elysia();
    const { worker } = deps;
    const sharedRegistry = deps.registry;
    const defaultBranch = deps.branch ?? "main";
    const sourceCwd = deps.sourceCwd;
    const pauseStore = deps.pauseStore ?? createPauseStore();

    /* -------- global error → JSON -------- */

    app.onError(({ code, error }) => {
        const message = error instanceof Error ? error.message : String(error);
        const status =
            code === "NOT_FOUND" ? 404
            : code === "VALIDATION" || code === "PARSE" ? 400
            : 500;
        return new Response(
            JSON.stringify({ ok: false, error: message, code }),
            { status, headers: { "Content-Type": "application/json" } },
        );
    });

    /* -------- health -------- */

    app.get("/api/health", () => ({
        ok: true,
        worldRoot: worker.worldRoot,
    }));

    /* -------- world config -------- */

    app.get("/api/world", () => ({
        ok: true,
        worldRoot: worker.worldRoot,
        branch: defaultBranch,
    }));

    /* -------- sessions -------- */

    /**
     * GET /api/sessions
     *
     * 列出所有 sessions（扫描 flows/* 目录，读取 .session.json 或目录名）。
     */
    app.get("/api/sessions", async () => {
        const flowsDir = path.join(worker.worldRoot, "flows");
        const sessions: Array<{ sessionId: string; createdAt?: string; threadCount: number }> = [];
        try {
            const entries = await fs.readdir(flowsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const sessionId = entry.name;
                let createdAt: string | undefined;
                // 尝试读取 .session.json
                const sessionFile = path.join(flowsDir, sessionId, ".session.json");
                try {
                    const raw = await fs.readFile(sessionFile, "utf8");
                    const meta = JSON.parse(raw) as { createdAt?: string };
                    createdAt = meta.createdAt;
                } catch {
                    // 无 .session.json 则 createdAt 为 undefined
                }
                // 统计 worker queue 中此 session 的 thread 数
                const threadCount = worker.list().filter((t) => t.sessionId === sessionId).length;
                sessions.push({ sessionId, createdAt, threadCount });
            }
        } catch {
            // flows/ 不存在时返回空数组
        }
        return { ok: true, sessions };
    });

    /**
     * POST /api/sessions
     * body: { objectUri: string; initPrompt?: string; systemPrompt?: string; maxTicks?: number }
     *
     * 创建 session 目录，返回 sessionId。
     *
     * 不再自动提交 init thread，避免与后续 /api/talk 产生竞争。
     * 如需在创建 session 时立即运行 LLM，传入 initPrompt（可选）：
     *   - 创建 init thread 并 runUntilThread 完成后再返回
     *   - 适用于需要预热或一次性初始化任务的场景
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

        // Validate or auto-generate sessionId
        let sessionId: string;
        try {
            sessionId = validateOrGenerateSessionId(b?.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        // Write .session.json (idempotent)
        const sessionMeta = { createdAt: new Date().toISOString(), objectUri };
        const sessionDir = path.join(worker.worldRoot, "flows", sessionId);
        await fs.mkdir(sessionDir, { recursive: true });
        const sessionFile = path.join(sessionDir, ".session.json");
        try {
            await fs.access(sessionFile);
            // already exists — idempotent
        } catch {
            await fs.writeFile(sessionFile, JSON.stringify(sessionMeta, null, 2));
        }

        // Optional: run init thread synchronously if initPrompt provided
        if (typeof b?.initPrompt === "string" && b.initPrompt.length > 0) {
            const threadId = shortId("t");
            const maxTicks = typeof b?.maxTicks === "number" ? b.maxTicks : 12;
            const systemPrompt = typeof b?.systemPrompt === "string"
                ? b.systemPrompt
                : `You are an OOC Object at ${objectUri}. Complete your task and stop.`;

            const thread: ThinkThread = {
                id: threadId,
                sessionId,
                objectUri,
                messages: [
                    { type: "message" as const, role: "system" as const, content: systemPrompt },
                    { type: "message" as const, role: "user" as const, content: b.initPrompt as string },
                ],
                status: "running",
                maxTicks,
                ticks: 0,
            };

            worker.submit(thread);
            await worker.runUntilThread(threadId, 90_000);

            return {
                ok: true,
                sessionId,
                threadId,
            };
        }

        return {
            ok: true,
            sessionId,
        };
    });

    /**
     * GET /api/sessions/:sessionId
     *
     * 返回 sessionId 下所有 thread 的快照。
     */
    app.get("/api/sessions/:sessionId", ({ params }) => {
        let sessionId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
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
     * 复用 deps.registry（包含 builtins）避免原型链解析失败。
     */
    app.post("/api/sessions/:sessionId/invoke", async ({ params, body }) => {
        let sessionId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
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
            // Reuse shared registry (includes builtins); supplement with any ephemeral flow objects
            let registry: ObjectRegistry;
            if (sharedRegistry) {
                registry = sharedRegistry;
                const flowRecords = await loadObjects({ worldRoot: worker.worldRoot, sessionId });
                for (const r of flowRecords) {
                    if (r.kind === "ephemeral") registry.set(r);
                }
            } else {
                registry = new ObjectRegistry();
                const records = await loadObjects({
                    worldRoot: worker.worldRoot,
                    branch: defaultBranch,
                    sessionId,
                });
                for (const r of records) registry.set(r);
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

    /* -------- stones browsing -------- */

    /**
     * GET /api/stones?branch=main
     *
     * 列出 branch 下所有 stone objects。
     * 合并 sourceCwd branch stones（如 9 个 AgentOfX）与 worldRoot branch stones（supervisor/user）。
     * worldRoot 同名 stone 覆盖 sourceCwd 同名 stone（URI 为 key）。
     * response: [{ uri, name, title, kind }]
     */
    app.get("/api/stones", async ({ query }) => {
        const branch = typeof query?.branch === "string" ? query.branch : defaultBranch;
        // 简单校验 branch 不含 ..
        if (branch.includes("..") || branch.includes("\0")) {
            return new Response(
                JSON.stringify({ ok: false, error: "invalid branch" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        /** 从指定 root 扫描 stones，按 uri 为 key 返回 Map。 */
        async function scanStones(root: string): Promise<Map<string, { uri: string; name: string; title?: string; kind: string }>> {
            const result = new Map<string, { uri: string; name: string; title?: string; kind: string }>();
            const objectsDir = path.join(root, "stones", branch, "objects");
            try {
                const entries = await fs.readdir(objectsDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const name = entry.name;
                    const uri = `ooc://stones/${branch}/objects/${name}`;
                    let title: string | undefined;
                    const selfPath = path.join(objectsDir, name, "self.md");
                    try {
                        const raw = await fs.readFile(selfPath, "utf8");
                        const m = raw.match(/^title:\s*(.+)$/m);
                        if (m) title = m[1]!.trim();
                    } catch {
                        // ok
                    }
                    result.set(uri, { uri, name, title, kind: "persistent" });
                }
            } catch {
                // objectsDir 不存在时忽略
            }
            return result;
        }

        // Start with cwd branch stones (AgentOfX from repo), then override with worldRoot stones
        const stoneMap = new Map<string, { uri: string; name: string; title?: string; kind: string }>();
        if (sourceCwd && sourceCwd !== worker.worldRoot) {
            for (const [k, v] of await scanStones(sourceCwd)) stoneMap.set(k, v);
        }
        for (const [k, v] of await scanStones(worker.worldRoot)) stoneMap.set(k, v);

        const stones = Array.from(stoneMap.values());
        return { ok: true, branch, stones };
    });

    /**
     * GET /api/stones/:branch/:name
     *
     * stone 元数据：paths, self frontmatter, readme content, flags。
     */
    app.get("/api/stones/:branch/:name", async ({ params }) => {
        const { branch, name } = params;
        if (branch.includes("..") || name.includes("..") || name.includes("/")) {
            return new Response(
                JSON.stringify({ ok: false, error: "invalid branch or name" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const stoneDir = path.join(worker.worldRoot, "stones", branch, "objects", name);
        const uri = `ooc://stones/${branch}/objects/${name}`;

        const selfContent = await readFileOrNull(path.join(stoneDir, "self.md"));
        if (selfContent === null) {
            return new Response(
                JSON.stringify({ ok: false, error: `stone not found: ${uri}` }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }
        const readmeContent = await readFileOrNull(path.join(stoneDir, "readme.md"));
        const hasServer = await fileExists(path.join(stoneDir, "server", "index.ts"));
        const hasClient = await fileExists(path.join(stoneDir, "client", "index.tsx"))
            || await fileExists(path.join(stoneDir, "client", "index.ts"));

        return {
            ok: true,
            uri,
            name,
            branch,
            paths: {
                stone: stoneDir,
                pool: path.join(worker.worldRoot, "pools", "objects", name),
            },
            self: selfContent,
            readme: readmeContent,
            hasServer,
            hasClient,
        };
    });

    /**
     * GET /api/stones/:branch/:name/self
     *
     * 返回 self.md 内容。
     */
    app.get("/api/stones/:branch/:name/self", async ({ params }) => {
        const { branch, name } = params;
        if (branch.includes("..") || name.includes("..") || name.includes("/")) {
            return new Response(
                JSON.stringify({ ok: false, error: "invalid params" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const abs = path.join(worker.worldRoot, "stones", branch, "objects", name, "self.md");
        const content = await readFileOrNull(abs);
        if (content === null) {
            return new Response(
                JSON.stringify({ ok: false, error: "self.md not found" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }
        return { ok: true, content };
    });

    /**
     * GET /api/stones/:branch/:name/readme
     *
     * 返回 readme.md 内容。
     */
    app.get("/api/stones/:branch/:name/readme", async ({ params }) => {
        const { branch, name } = params;
        if (branch.includes("..") || name.includes("..") || name.includes("/")) {
            return new Response(
                JSON.stringify({ ok: false, error: "invalid params" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const abs = path.join(worker.worldRoot, "stones", branch, "objects", name, "readme.md");
        const content = await readFileOrNull(abs);
        if (content === null) {
            return new Response(
                JSON.stringify({ ok: false, error: "readme.md not found" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }
        return { ok: true, content };
    });

    /**
     * GET /api/stones/:branch/:name/server-source
     *
     * 返回 server/index.ts 内容。
     */
    app.get("/api/stones/:branch/:name/server-source", async ({ params }) => {
        const { branch, name } = params;
        if (branch.includes("..") || name.includes("..") || name.includes("/")) {
            return new Response(
                JSON.stringify({ ok: false, error: "invalid params" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const abs = path.join(
            worker.worldRoot,
            "stones",
            branch,
            "objects",
            name,
            "server",
            "index.ts",
        );
        const content = await readFileOrNull(abs);
        if (content === null) {
            return new Response(
                JSON.stringify({ ok: false, error: "server/index.ts not found" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }
        return { ok: true, content };
    });

    /**
     * POST /api/stones/:branch/:name/call-method
     * body: { method: string; args?: unknown; sessionId?: string }
     *
     * 调用 stone public method（通过 dispatcher.invokeMethod）。
     * 复用 deps.registry（包含 builtins）避免原型链解析失败。
     */
    app.post("/api/stones/:branch/:name/call-method", async ({ params, body }) => {
        const { branch, name } = params;
        if (branch.includes("..") || name.includes("..") || name.includes("/")) {
            return new Response(
                JSON.stringify({ ok: false, error: "invalid params" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const b = body as Record<string, unknown>;
        const method = typeof b?.method === "string" ? b.method : undefined;
        if (!method) {
            return new Response(
                JSON.stringify({ ok: false, error: "method required" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const sessionId = typeof b?.sessionId === "string" ? b.sessionId : shortId("ses");
        const objectUri = `ooc://stones/${branch}/objects/${name}`;

        try {
            // Reuse shared registry (includes builtins); supplement with any ephemeral flow objects
            let registry: ObjectRegistry;
            if (sharedRegistry) {
                registry = sharedRegistry;
                const flowRecords = await loadObjects({ worldRoot: worker.worldRoot, sessionId });
                for (const r of flowRecords) {
                    if (r.kind === "ephemeral") registry.set(r);
                }
            } else {
                registry = new ObjectRegistry();
                const records = await loadObjects({
                    worldRoot: worker.worldRoot,
                    branch,
                    sessionId,
                });
                for (const r of records) registry.set(r);
            }

            const ctx = { worldRoot: worker.worldRoot, sessionId, registry };
            const result = await invokeMethod(registry, objectUri, method, b.args ?? {}, ctx);
            return { ok: true, result };
        } catch (error) {
            return new Response(
                JSON.stringify({ ok: false, error: (error as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
    });

    /* -------- flows / objects detail -------- */

    /**
     * GET /api/flows/:sessionId/objects
     *
     * 列出 session 内所有 objects（ephemeral + persistent active in session）。
     * 过滤条件：排除由 talk() 自动创建的用户侧 inbox 目录（不含 self.md 且名称
     * 匹配 slugified user URI 模式，如 "me"，"users__me" 等）。
     */
    app.get("/api/flows/:sessionId/objects", async ({ params }) => {
        let sessionId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const flowObjectsDir = path.join(worker.worldRoot, "flows", sessionId, "objects");
        const objects: Array<{ name: string; uri: string; kind: string }> = [];
        const registry = sharedRegistry;

        /** Ghost names: directories created as side-effects of talk() for user addresses. */
        const GHOST_NAMES = new Set(["me", "users__me"]);

        try {
            const entries = await fs.readdir(flowObjectsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const name = entry.name;
                const uri = `ooc://flows/${sessionId}/objects/${name}`;

                // Filter out ghost user-inbox directories that have no self.md AND
                // are not registered as known objects in the registry
                if (GHOST_NAMES.has(name)) {
                    const selfMdPath = path.join(flowObjectsDir, name, "self.md");
                    const hasSelfMd = await fileExists(selfMdPath);
                    const isRegistered = registry
                        ? !!registry.get(`ooc://stones/main/objects/${name}`) || !!registry.get(`ooc://users/${name}`)
                        : false;
                    if (!hasSelfMd && !isRegistered) continue;
                }

                objects.push({
                    name,
                    uri,
                    kind: "ephemeral",
                });
            }
        } catch {
            // no objects dir yet
        }
        // Also include running thread object URIs from worker.
        // Deduplicate by name: prefer persistent URI over ephemeral when both exist.
        const threadUris = worker
            .list()
            .filter((t) => t.sessionId === sessionId)
            .map((t) => t.objectUri);
        for (const uri of threadUris) {
            const name = uri.split("/").pop()!;
            const existingIdx = objects.findIndex((o) => o.name === name);
            if (existingIdx === -1) {
                objects.push({ name, uri, kind: "persistent" });
            } else {
                // Replace ephemeral entry with persistent URI (persistent is canonical)
                objects[existingIdx] = { name, uri, kind: "persistent" };
            }
        }
        return { ok: true, sessionId, objects };
    });

    /**
     * GET /api/flows/:sessionId/objects/:objectName
     *
     * object 摘要：plan + todos + recent talks + threads。
     * 若 object 目录不存在（且无 active worker thread）返回 404。
     */
    app.get("/api/flows/:sessionId/objects/:objectName", async ({ params }) => {
        let sessionId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const { objectName } = params;
        const flowDir = path.join(worker.worldRoot, "flows", sessionId, "objects", objectName);

        // Check if object exists (flow dir or active thread)
        let flowDirExists = false;
        try {
            const stat = await fs.stat(flowDir);
            flowDirExists = stat.isDirectory();
        } catch {
            // doesn't exist
        }
        const hasActiveThread = worker.list().some(
            (t) => t.sessionId === sessionId && t.objectUri.endsWith(`/${objectName}`),
        );
        if (!flowDirExists && !hasActiveThread) {
            return new Response(
                JSON.stringify({ ok: false, error: `object not found: ${objectName}` }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }

        const plan = await readFileOrNull(path.join(flowDir, "plan.md"));
        let todos: unknown = null;
        try {
            const todosRaw = await fs.readFile(path.join(flowDir, "todos.json"), "utf8");
            todos = JSON.parse(todosRaw);
        } catch {
            // ok
        }

        // Recent talks: list talks/*.jsonl files
        const talksDir = path.join(flowDir, "talks");
        const talks: Array<{ peer: string; entries: unknown[] }> = [];
        try {
            const talkFiles = await fs.readdir(talksDir);
            for (const f of talkFiles) {
                if (!f.endsWith(".jsonl")) continue;
                const raw = await fs.readFile(path.join(talksDir, f), "utf8");
                const entries = raw
                    .trim()
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => {
                        try { return JSON.parse(line); } catch { return null; }
                    })
                    .filter(Boolean);
                // peer slug: file name without .jsonl
                const peerSlug = f.slice(0, -6);
                talks.push({ peer: peerSlug, entries });
            }
        } catch {
            // no talks yet
        }

        // Threads: list threads/ subdirs
        const threadsDir = path.join(flowDir, "threads");
        const threadIds: string[] = [];
        try {
            const entries = await fs.readdir(threadsDir, { withFileTypes: true });
            for (const e of entries) {
                if (e.isDirectory()) threadIds.push(e.name);
            }
        } catch {
            // ok
        }

        // Worker thread snapshots for this object
        const activeThreads = worker.list().filter(
            (t) => t.sessionId === sessionId && t.objectUri.endsWith(`/${objectName}`),
        );

        return {
            ok: true,
            sessionId,
            objectName,
            plan,
            todos,
            talks,
            threadIds,
            activeThreads: activeThreads.map((t) => ({
                id: t.id,
                status: t.status,
                ticks: t.ticks,
                maxTicks: t.maxTicks,
                messageCount: t.messages.length,
                lastError: t.lastError,
            })),
        };
    });

    /**
     * GET /api/flows/:sessionId/objects/:objectName/threads/:threadId
     *
     * thread 状态（从 worker queue 读，或从磁盘读）。
     */
    app.get("/api/flows/:sessionId/objects/:objectName/threads/:threadId", async ({ params }) => {
        let sessionId: string;
        let threadId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
            threadId = validateThreadIdParam(params.threadId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const { objectName } = params;

        // First check worker queue
        const thread = worker.get(threadId);
        if (thread && thread.sessionId === sessionId) {
            return { ok: true, source: "memory", thread };
        }

        // Fall back to disk
        const threadFile = path.join(
            worker.worldRoot,
            "flows",
            sessionId,
            "objects",
            objectName,
            "threads",
            threadId,
            "thread.json",
        );
        const raw = await readFileOrNull(threadFile);
        if (raw === null) {
            return new Response(
                JSON.stringify({ ok: false, error: "thread not found" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }
        try {
            const persisted = JSON.parse(raw) as ThinkThread;
            return { ok: true, source: "disk", thread: persisted };
        } catch {
            return new Response(
                JSON.stringify({ ok: false, error: "thread.json parse error" }),
                { status: 500, headers: { "Content-Type": "application/json" } },
            );
        }
    });

    /* -------- file tree & read -------- */

    /**
     * GET /api/tree?path=<relative>&depth=<N>&recursive=<bool>
     *
     * 列出 worldRoot 下 path 的文件/目录条目。
     * - depth 参数：0=仅当前层（默认），N>0 递归展开 N 层，-1 完全递归（最多 10 层）。
     * - recursive=true 等价于 depth=10（兼容 ooc-2 sidebar FileTree）。
     * - 返回 entries[]（flat，兼容旧形状）+ root（tree 形状，含 children）。
     *
     * path 省略时列 worldRoot 本身。
     */
    app.get("/api/tree", async ({ query }) => {
        const relPath = typeof query?.path === "string" ? query.path : "";
        const abs = relPath
            ? safeResolvePath(worker.worldRoot, relPath)
            : worker.worldRoot;
        if (!abs) {
            return new Response(
                JSON.stringify({ ok: false, error: "invalid path" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        // Parse depth / recursive
        const recursiveParam = query?.recursive === "true" || query?.recursive === "1";
        let depth = 0;
        if (typeof query?.depth === "string") {
            const d = parseInt(query.depth, 10);
            if (!isNaN(d)) depth = Math.min(Math.max(d, -1), 10);
        }
        if (recursiveParam && depth === 0) depth = 10;
        if (depth < 0) depth = 10; // -1 = full recursive, capped at 10

        // Build tree (depth>0) or flat list (depth=0)
        const name = relPath ? path.basename(abs) : ".";
        let rootNode: FileTreeNode | undefined;
        if (depth > 0) {
            const children = await buildTree(abs, relPath || "", depth - 1);
            rootNode = { name, type: "dir", path: relPath || ".", children };
        }

        // Also return flat entries for backward compat
        const entries = await listDir(abs);
        return { ok: true, path: relPath || ".", entries, root: rootNode };
    });

    /**
     * GET /api/file/read?path=<relative>
     *
     * 读取 worldRoot 范围内的文件内容（最大 1 MB）。
     */
    app.get("/api/file/read", async ({ query }) => {
        const relPath = typeof query?.path === "string" ? query.path : undefined;
        if (!relPath) {
            return new Response(
                JSON.stringify({ ok: false, error: "path query param required" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const result = await safeReadFile(worker.worldRoot, relPath);
        if (!result) {
            return new Response(
                JSON.stringify({ ok: false, error: "file not found or access denied" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }
        return { ok: true, ...result };
    });

    /* -------- object client source URL -------- */

    /**
     * GET /api/objects/:scope/:name/client-source-url
     *
     * 返回 client/index.ts(x) 的 /@fs/ URL（供 vite dev + HMR），若无则 null。
     * scope: branch name（e.g. "main"）
     */
    app.get("/api/objects/:scope/:name/client-source-url", async ({ params }) => {
        const { scope, name } = params;
        if (scope.includes("..") || name.includes("..") || name.includes("/")) {
            return new Response(
                JSON.stringify({ ok: false, error: "invalid params" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const stoneBase = path.join(worker.worldRoot, "stones", scope, "objects", name, "client");
        for (const fname of ["index.tsx", "index.ts", "index.jsx", "index.js"]) {
            const abs = path.join(stoneBase, fname);
            if (await fileExists(abs)) {
                return { ok: true, url: `/@fs${abs}` };
            }
        }
        return { ok: true, url: null };
    });

    /* -------- talk -------- */

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

        // Validate or auto-generate sessionId (reject path-traversal attempts)
        let sessionId: string;
        try {
            sessionId = validateOrGenerateSessionId(b?.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
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

            // Write .session.json for this session (idempotent)
            const sessionDir = path.join(worker.worldRoot, "flows", sessionId);
            await fs.mkdir(sessionDir, { recursive: true });
            const sessionFile = path.join(sessionDir, ".session.json");
            try {
                await fs.access(sessionFile);
            } catch {
                await fs.writeFile(
                    sessionFile,
                    JSON.stringify({ createdAt: ts, objectUri: targetUri }, null, 2),
                );
            }

            // 3. Create ThinkThread for target with the in-talk as initial user message
            // Record startTs BEFORE submitting so we can filter only new out messages below
            const startTs = ts;
            const threadId = shortId("t");
            const thread: ThinkThread = {
                id: threadId,
                sessionId,
                objectUri: targetUri,
                messages: [
                    {
                        type: "message" as const,
                        role: "system" as const,
                        content: `You are an OOC Object at ${targetUri}. A user has sent you a message via talk. Respond to the user's message using your available methods, then call talk() to send your response back to the user (target: "${userUri}"). After sending your reply, call end() to terminate the conversation. Don't call exploratory tools unless they are necessary for the user's request — trust your context.`,
                    },
                    {
                        type: "message" as const,
                        role: "user" as const,
                        content: `[talk from ${userUri}]\n${content}\n[/talk]`,
                    },
                ],
                status: "running",
                maxTicks: typeof b?.maxTicks === "number" ? b.maxTicks : 25,
                ticks: 0,
                llmTimeoutMs: typeof b?.llmTimeoutMs === "number" ? b.llmTimeoutMs : 120_000,
            };

            // 4. Submit and run worker until this specific thread is done
            // Use runUntilThread (not runUntilDone) to avoid blocking concurrent talk requests
            // Wall-clock budget = maxTicks × per-LLM-timeout + 30s buffer
            const wallClockMs = thread.maxTicks * (thread.llmTimeoutMs ?? 120_000) + 30_000;
            worker.submit(thread);
            await worker.runUntilThread(threadId, wallClockMs);

            // 5. Read target's talks file for out messages with ts > startTs (time-scoped to this request)
            const talksDir = path.join(worker.worldRoot, "flows", sessionId, "objects", targetName, "talks");
            const userSlug = userUri.replace(/^ooc:\/\//, "").replace(/\//g, "__");
            const talksFile = path.join(talksDir, `${userSlug}.jsonl`);
            let response: string | undefined;
            try {
                const raw = await fs.readFile(talksFile, "utf8");
                const lines = raw.trim().split("\n").filter(Boolean);
                // Find last out message with ts strictly after startTs (avoids stale multi-turn attribution)
                for (let i = lines.length - 1; i >= 0; i--) {
                    const entry = JSON.parse(lines[i]!) as { direction: string; content: string; ts?: string };
                    if (entry.direction === "out" && (!entry.ts || entry.ts > startTs)) {
                        response = entry.content;
                        break;
                    }
                }
                // Fall back to any out message if none found with ts filter
                if (!response) {
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const entry = JSON.parse(lines[i]!) as { direction: string; content: string };
                        if (entry.direction === "out") {
                            response = entry.content;
                            break;
                        }
                    }
                }
            } catch {
                // No talks file yet — target LLM may not have called talk() back
            }

            // If no talk-back found, check thread's final assistant message as fallback
            if (!response) {
                const lastAssistant = [...thread.messages]
                    .reverse()
                    .find((m) => m.type === "message" && m.role === "assistant");
                response = lastAssistant && "content" in lastAssistant ? lastAssistant.content as string : undefined;
            }

            // Explicit incomplete signal: if thread hit maxTicks and no response was produced,
            // return null response + "incomplete" status rather than returning mid-reasoning text.
            const hitMaxTicks = thread.ticks >= thread.maxTicks && thread.status === "done";
            const incomplete = hitMaxTicks && !response;

            return {
                ok: true,
                sessionId,
                threadId,
                response: incomplete ? null : (response ?? ""),
                threadStatus: incomplete ? "incomplete" : thread.status,
            };
        } catch (error) {
            return new Response(
                JSON.stringify({ ok: false, error: (error as Error).message }),
                { status: 500, headers: { "Content-Type": "application/json" } },
            );
        }
    });

    /* -------- /api/flows — rich sessions list (ooc-2 compat) -------- */

    /**
     * GET /api/flows
     *
     * 与 ooc-2 兼容的 session 列表，含 title / createdAt(ms) / updatedAt(ms)。
     * ooc-2 前端 fetchFlows() 期望 { items: FlowSession[], hash }。
     *
     * createdAt: .session.json 中读
     * updatedAt: flows/<sid>/ 目录下最新 thread.json 的 mtime（无则用 createdAt）
     * title: .session.json 中 title 字段（可选）
     */
    app.get("/api/flows", async () => {
        const flowsDir = path.join(worker.worldRoot, "flows");
        const items: Array<{
            sessionId: string;
            title: string;
            dir: string;
            createdAt: number;
            updatedAt: number;
            paused?: boolean;
        }> = [];
        try {
            const entries = await fs.readdir(flowsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const sessionId = entry.name;
                const sessionDir = path.join(flowsDir, sessionId);
                let createdAt = Date.now();
                let title = sessionId;
                // Read .session.json
                try {
                    const raw = await fs.readFile(path.join(sessionDir, ".session.json"), "utf8");
                    const meta = JSON.parse(raw) as { createdAt?: string; title?: string };
                    if (meta.createdAt) createdAt = Date.parse(meta.createdAt) || createdAt;
                    if (meta.title) title = meta.title;
                } catch {
                    // ok
                }
                // Derive updatedAt from most-recent thread.json mtime
                let updatedAt = createdAt;
                try {
                    const objectsDir = path.join(sessionDir, "objects");
                    const objDirs = await fs.readdir(objectsDir, { withFileTypes: true });
                    for (const od of objDirs) {
                        if (!od.isDirectory()) continue;
                        const threadsDir = path.join(objectsDir, od.name, "threads");
                        try {
                            const tDirs = await fs.readdir(threadsDir, { withFileTypes: true });
                            for (const td of tDirs) {
                                if (!td.isDirectory()) continue;
                                const tjPath = path.join(threadsDir, td.name, "thread.json");
                                try {
                                    const stat = await fs.stat(tjPath);
                                    const mt = stat.mtimeMs;
                                    if (mt > updatedAt) updatedAt = mt;
                                } catch {
                                    // ok
                                }
                            }
                        } catch {
                            // ok
                        }
                    }
                } catch {
                    // no objects dir
                }
                items.push({
                    sessionId,
                    title,
                    dir: sessionDir,
                    createdAt,
                    updatedAt,
                    paused: pauseStore.isSessionPaused(sessionId),
                });
            }
        } catch {
            // flows/ doesn't exist
        }
        // Sort newest first
        items.sort((a, b) => b.updatedAt - a.updatedAt);
        // Simple hash: stringify sorted ids+updatedAt
        const hash = items.map((i) => `${i.sessionId}:${i.updatedAt}`).join("|");
        return { ok: true, items, hash };
    });

    /* -------- /api/flows/:sessionId/threads -------- */

    /**
     * GET /api/flows/:sessionId/threads
     *
     * 列出 session 下所有 (objectId, threadId, status, createdAt?)。
     * 数据来源：
     *   1. 磁盘 flows/SID/objects/NAME/threads/TID/thread.json（已完成的）
     *   2. 内存 worker queue（运行中的）
     * 合并去重（worker queue 优先，以获取最新 status）。
     *
     * Response: { ok, items: ListThreadsItem[] }
     * ListThreadsItem: { objectId, threadId, status?, createdAt? }
     */
    app.get("/api/flows/:sessionId/threads", async ({ params }) => {
        let sessionId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        const flowDir = path.join(worker.worldRoot, "flows", sessionId);
        const objectsDir = path.join(flowDir, "objects");

        // key = "objectId/threadId"
        const threadMap = new Map<string, { objectId: string; threadId: string; status?: string; createdAt?: string }>();

        // 1. Scan disk
        try {
            const objDirs = await fs.readdir(objectsDir, { withFileTypes: true });
            for (const od of objDirs) {
                if (!od.isDirectory()) continue;
                const objectId = od.name;
                const threadsDir = path.join(objectsDir, objectId, "threads");
                try {
                    const tDirs = await fs.readdir(threadsDir, { withFileTypes: true });
                    for (const td of tDirs) {
                        if (!td.isDirectory()) continue;
                        const threadId = td.name;
                        const key = `${objectId}/${threadId}`;
                        let status: string | undefined;
                        let createdAt: string | undefined;
                        try {
                            const raw = await fs.readFile(
                                path.join(threadsDir, threadId, "thread.json"),
                                "utf8",
                            );
                            const t = JSON.parse(raw) as { status?: string };
                            status = t.status;
                        } catch {
                            // ok
                        }
                        threadMap.set(key, { objectId, threadId, status, createdAt });
                    }
                } catch {
                    // no threads dir
                }
            }
        } catch {
            // no objects dir
        }

        // 2. Merge worker queue (overrides disk for running threads)
        for (const t of worker.list()) {
            if (t.sessionId !== sessionId) continue;
            const objectId = t.objectUri.split("/").pop()!;
            const key = `${objectId}/${t.id}`;
            threadMap.set(key, {
                objectId,
                threadId: t.id,
                status: t.status,
            });
        }

        const items = Array.from(threadMap.values());
        return { ok: true, items };
    });

    /* -------- pause / resume -------- */

    /**
     * POST /api/flows/:sessionId/pause
     *
     * 标记 session 为已暂停。Worker tick 通过 pauseStore.isSessionPaused()
     * 判断跳过该 session 的 LLM 调用。
     * TODO(P9): wire pauseStore into Worker.tick() loop to actually gate LLM calls.
     */
    app.post("/api/flows/:sessionId/pause", ({ params }) => {
        let sessionId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        pauseStore.pauseSession(sessionId);
        return { ok: true, sessionId, paused: true };
    });

    /**
     * POST /api/flows/:sessionId/resume
     *
     * 取消 session 的暂停标记。返回空 jobIds（ooc-3 无异步 job 层；同步 talk 模式）。
     * TODO(P9): wire pauseStore into Worker.tick() loop.
     */
    app.post("/api/flows/:sessionId/resume", ({ params }) => {
        let sessionId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        pauseStore.resumeSession(sessionId);
        return { ok: true, sessionId, paused: false, jobIds: [] as string[] };
    });

    /* -------- /api/flows/:sessionId/continue -------- */

    /**
     * POST /api/flows/:sessionId/continue
     * body: { text: string; targetObjectId?: string; targetThreadId?: string }
     *
     * ooc-2 compat alias around /api/talk. Accepts the ooc-2 continue body shape
     * and delegates to the same worker.submit + runUntilThread logic.
     *
     * Returns { ok, jobId, sessionId, threadId } where jobId == threadId
     * (ooc-3 has no async job layer; jobId is a synthetic immediate-done marker).
     *
     * The frontend polls GET /api/runtime/jobs/:jobId — that endpoint returns
     * { status: "done" } immediately since the talk already completed synchronously.
     */
    app.post("/api/flows/:sessionId/continue", async ({ params, body }) => {
        let sessionId: string;
        try {
            sessionId = validateSessionIdParam(params.sessionId);
        } catch (e) {
            return new Response(
                JSON.stringify({ ok: false, error: (e as Error).message }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }
        const b = body as Record<string, unknown>;
        const text = typeof b?.text === "string" ? b.text : undefined;
        if (!text) {
            return new Response(
                JSON.stringify({ ok: false, error: "text required" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        // Derive targetUri from session's .session.json objectUri or body
        let targetUri: string | undefined;
        if (typeof b?.targetObjectId === "string" && b.targetObjectId.length > 0) {
            // If targetObjectId looks like a full URI, use it directly; otherwise wrap
            const t = b.targetObjectId as string;
            targetUri = t.startsWith("ooc://") ? t : `ooc://stones/${defaultBranch}/objects/${t}`;
        } else {
            // Fall back: read .session.json for original objectUri
            try {
                const raw = await fs.readFile(
                    path.join(worker.worldRoot, "flows", sessionId, ".session.json"),
                    "utf8",
                );
                const meta = JSON.parse(raw) as { objectUri?: string };
                if (meta.objectUri) targetUri = meta.objectUri;
            } catch {
                // ok
            }
        }

        if (!targetUri) {
            return new Response(
                JSON.stringify({ ok: false, error: "cannot determine target object for session; provide targetObjectId or create session first" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        // Delegate to /api/talk logic (inline, not HTTP redirect)
        const userUri = "ooc://users/me";
        const targetName = targetUri.split("/").pop()!;
        const ts = new Date().toISOString();

        try {
            let registry: ObjectRegistry;
            if (sharedRegistry) {
                registry = sharedRegistry;
                const flowRecords = await loadObjects({ worldRoot: worker.worldRoot, sessionId });
                for (const r of flowRecords) {
                    if (r.kind === "ephemeral") registry.set(r);
                }
            } else {
                registry = new ObjectRegistry();
                const records = await loadObjects({ worldRoot: worker.worldRoot, branch: defaultBranch, sessionId });
                for (const r of records) registry.set(r);
            }

            await appendTalkEntry(worker.worldRoot, sessionId, targetName, {
                ts,
                direction: "in",
                peer: userUri,
                content: text,
            });

            const threadId = shortId("t");
            const thread: ThinkThread = {
                id: threadId,
                sessionId,
                objectUri: targetUri,
                messages: [
                    {
                        type: "message" as const,
                        role: "system" as const,
                        content: `You are an OOC Object at ${targetUri}. A user has sent you a follow-up message. Respond via talk(), then call end().`,
                    },
                    {
                        type: "message" as const,
                        role: "user" as const,
                        content: `[talk from ${userUri}]\n${text}\n[/talk]`,
                    },
                ],
                status: "running",
                maxTicks: typeof b?.maxTicks === "number" ? b.maxTicks : 25,
                ticks: 0,
                llmTimeoutMs: 120_000,
            };

            worker.submit(thread);
            const wallClockMs = thread.maxTicks * (thread.llmTimeoutMs ?? 120_000) + 30_000;
            await worker.runUntilThread(threadId, wallClockMs);

            // Return jobId = threadId (immediate-done synthetic job)
            return { ok: true, sessionId, threadId, jobId: threadId };
        } catch (error) {
            return new Response(
                JSON.stringify({ ok: false, error: (error as Error).message }),
                { status: 500, headers: { "Content-Type": "application/json" } },
            );
        }
    });

    /* -------- /api/runtime/jobs/:jobId -------- */

    /**
     * GET /api/runtime/jobs/:jobId
     *
     * ooc-2 frontend polls this after POST /continue to know when LLM is done.
     * In ooc-3, /api/flows/:sid/continue is synchronous — the talk already
     * completed before we returned jobId. So this always returns { status: "done" }.
     *
     * jobId = threadId (as returned by /continue). We verify the thread exists
     * and return its actual status if available; otherwise "done" (safe fallback).
     */
    app.get("/api/runtime/jobs/:jobId", ({ params }) => {
        const { jobId } = params;
        // Check if it's a known thread
        const thread = worker.get(jobId);
        if (thread) {
            const status = thread.status === "running" ? "running" : "done";
            return { ok: true, jobId, status };
        }
        // Not in queue = already completed (persisted to disk)
        return { ok: true, jobId, status: "done" };
    });

    /* -------- /api/world/config -------- */

    /**
     * GET /api/world/config
     *
     * ooc-2 compat alias for /api/world. Returns siteName from .world.json if present.
     */
    app.get("/api/world/config", async () => {
        let siteName = "Oriented Object Context";
        try {
            const raw = await fs.readFile(path.join(worker.worldRoot, ".world.json"), "utf8");
            const cfg = JSON.parse(raw) as { siteName?: string };
            if (typeof cfg.siteName === "string" && cfg.siteName.trim().length > 0) {
                siteName = cfg.siteName.trim();
            }
        } catch {
            // ok — fallback to default
        }
        return {
            ok: true,
            worldRoot: worker.worldRoot,
            branch: defaultBranch,
            siteName,
        };
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
