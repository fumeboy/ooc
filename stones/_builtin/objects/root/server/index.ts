/**
 * stones/_builtin/objects/root/server/index.ts
 *
 * OOC-3 根原型的 server method 集合。
 *
 * P4 阶段: methods 是 skeleton (参数解析 + 占位返回 + TODO 标 P5)；
 *          defaultContext() 是真实实装（按 spec §3.5）。
 * P5 阶段: 11 个 B 类 method body 替换为真实 flow 层写入实装；
 *          其余 6 个 (grep/glob/open_file/open_knowledge/metaprog/write_file/end) 仍 skeleton (P6+)。
 *
 * 详见 spec V2 §3 + meta/object.doc.ts:patches.b_class_collapse。
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defineObject, type ObjectContext } from "@src/executable/server";
import {
    appendTalkEntry,
    ensureFlowDir,
    ensureThreadDir,
    nameFromUri,
    planFile,
    shortId,
    threadDir,
    todosFile,
} from "@src/persistable/flow-paths";

/* -------------------- defaultContext: 真实实装 -------------------- */

/**
 * defaultContext slice 结构：每轮 LLM 调用前拼装的 context 部分。
 */
export type DefaultContextSlice = {
    kind: "plan" | "todos" | "threads" | "talks" | "relations";
    payload: unknown;
};

/**
 * defaultContext(): 从 active flow 读取并拼装当前 Object 的 context 切片。
 *
 * 子原型可 override 加自己的切片。
 */
export async function defaultContext(ctx: ObjectContext): Promise<DefaultContextSlice[]> {
    const slices: DefaultContextSlice[] = [];
    const flowPath = ctx.record.paths.flow;
    if (!flowPath) {
        // 无 active flow → 只返回 relations (从 stone 推导)
        slices.push({ kind: "relations", payload: computeRelations(ctx) });
        return slices;
    }

    // 1. active plan
    const planPath = path.join(flowPath, "plan.md");
    const planContent = await readIfExists(planPath);
    if (planContent && planContent.trim().length > 0) {
        slices.push({ kind: "plan", payload: planContent });
    }

    // 2. unfinished todos
    const todosPath = path.join(flowPath, "todos.json");
    const todosBody = await readIfExists(todosPath);
    if (todosBody) {
        try {
            const parsed = JSON.parse(todosBody) as { items?: Array<{ id: string; content: string; checked: boolean }> };
            const unfinished = (parsed.items ?? []).filter((it) => !it.checked);
            if (unfinished.length > 0) {
                slices.push({ kind: "todos", payload: unfinished });
            }
        } catch {
            // 静默跳过损坏 JSON；不污染 context
        }
    }

    // 3. active threads (= flow/threads/<id>/ 内 thread.json 存在且 status != closed)
    const threadsRoot = path.join(flowPath, "threads");
    const active: string[] = [];
    if (await directoryExists(threadsRoot)) {
        const ids = await listSubdirs(threadsRoot);
        for (const id of ids) {
            const threadJson = path.join(threadsRoot, id, "thread.json");
            const tBody = await readIfExists(threadJson);
            if (tBody) {
                try {
                    const t = JSON.parse(tBody) as { status?: string };
                    if (t.status !== "closed") {
                        active.push(id);
                    }
                } catch {
                    // 损坏 thread.json 视为 active (保守)
                    active.push(id);
                }
            }
        }
    }
    if (active.length > 0) {
        slices.push({ kind: "threads", payload: active });
    }

    // 4. recent talks (= flow/talks/<peer>.jsonl 各取最后 N 条摘要)
    const talksRoot = path.join(flowPath, "talks");
    if (await directoryExists(talksRoot)) {
        const recent: Array<{ peer: string; lastLines: string[] }> = [];
        const peers = await fs.readdir(talksRoot);
        for (const peerFile of peers) {
            if (!peerFile.endsWith(".jsonl")) continue;
            const body = await readIfExists(path.join(talksRoot, peerFile));
            if (!body) continue;
            const lines = body.trim().split("\n").slice(-3); // 最后 3 条
            recent.push({
                peer: peerFile.replace(/\.jsonl$/, ""),
                lastLines: lines,
            });
        }
        if (recent.length > 0) {
            slices.push({ kind: "talks", payload: recent });
        }
    }

    // 5. relations (从 stone children/ + 同级扫描)
    slices.push({ kind: "relations", payload: computeRelations(ctx) });

    return slices;
}

function computeRelations(ctx: ObjectContext): { siblings: string[]; children: string[] } {
    const all = ctx.registry.list();
    const selfUri = ctx.record.uri;
    const selfStonePath = ctx.record.paths.stone;

    const children: string[] = [];
    if (selfStonePath) {
        const childrenPrefix = `${selfUri}/children/`;
        for (const r of all) {
            if (r.uri.startsWith(childrenPrefix)) {
                // 仅一层 child（不递归 grand-children）
                const tail = r.uri.slice(childrenPrefix.length);
                if (!tail.includes("/")) {
                    children.push(r.uri);
                }
            }
        }
    }

    const siblings: string[] = [];
    if (selfStonePath) {
        // siblings = 同 branch/<dir>/objects/ 下，与 self 同层但不同 name
        const parts = selfUri.split("/");
        // ooc://stones/<branch>/objects/<name>[/children/<...>] 取 parent prefix
        // 此处只处理顶层 sibling；children 内部不算 sibling
        if (parts.length >= 6 && parts[2] === "stones" && parts[4] === "objects" && parts.length === 6) {
            const parentPrefix = parts.slice(0, 5).join("/") + "/";
            for (const r of all) {
                if (r.uri !== selfUri && r.uri.startsWith(parentPrefix)) {
                    const tail = r.uri.slice(parentPrefix.length);
                    if (!tail.includes("/")) {
                        siblings.push(r.uri);
                    }
                }
            }
        }
    }

    return { siblings, children };
}

/* -------------------- private module-level helper -------------------- */

async function _mutateTodoChecked(
    ctx: ObjectContext,
    id: string,
    checked: boolean,
): Promise<{ ok: boolean }> {
    if (!ctx.sessionId) throw new Error("todo: no active sessionId");
    const selfName = nameFromUri(ctx.record.uri);
    await ensureFlowDir(ctx.worldRoot, ctx.sessionId, selfName);
    const f = todosFile(ctx.worldRoot, ctx.sessionId, selfName);
    let data: { items: any[] } = { items: [] };
    try {
        data = JSON.parse(await fs.readFile(f, "utf8"));
        if (!Array.isArray(data.items)) data.items = [];
    } catch { return { ok: false }; }
    let found = false;
    for (const it of data.items) {
        if (it.id === id) {
            it.checked = checked;
            it.updated_at = new Date().toISOString();
            found = true;
        }
    }
    await fs.writeFile(f, JSON.stringify(data, null, 2));
    return { ok: found };
}

/* -------------------- public methods: B 类 real impl + skeleton 其余 -------------------- */

export default defineObject({
    public: {
        async talk(args: any, ctx: ObjectContext) {
            if (!args || typeof args.target !== "string" || typeof args.content !== "string") {
                throw new Error("talk: args.target (string) and args.content (string) required");
            }
            if (!ctx.sessionId) {
                throw new Error("talk: no active sessionId");
            }
            const ts = new Date().toISOString();
            const selfName = nameFromUri(ctx.record.uri);
            const targetName = nameFromUri(args.target);

            // 1. self 端 → talks/<target>.jsonl direction=out
            await appendTalkEntry(ctx.worldRoot, ctx.sessionId, selfName, {
                ts,
                direction: "out",
                peer: args.target,
                content: args.content,
            });

            // 2. target 端 → talks/<self>.jsonl direction=in (auto-create flow dir for target)
            await appendTalkEntry(ctx.worldRoot, ctx.sessionId, targetName, {
                ts,
                direction: "in",
                peer: ctx.record.uri,
                content: args.content,
            });

            // TODO P6: schedule target's worker to wake
            return { ok: true, ts };
        },

        async do(args: any, ctx: ObjectContext) {
            if (!args || typeof args.intent !== "string") {
                throw new Error("do: args.intent (string) required");
            }
            if (!ctx.sessionId) {
                throw new Error("do: no active sessionId");
            }
            const selfName = nameFromUri(ctx.record.uri);
            const threadId = shortId("t");
            const dir = await ensureThreadDir(ctx.worldRoot, ctx.sessionId, selfName, threadId);
            const intent: any = { intent: args.intent };
            if (typeof args.parent_thread_id === "string") {
                intent.parent_thread_id = args.parent_thread_id;
            }
            await fs.writeFile(
                path.join(dir, "intent.md"),
                `---\n${Object.entries(intent).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n${args.intent}\n`,
            );
            await fs.writeFile(
                path.join(dir, "thread.json"),
                JSON.stringify({ id: threadId, status: "active", created_at: new Date().toISOString() }, null, 2),
            );
            return { ok: true, thread_id: threadId };
        },

        async do_close(args: any, ctx: ObjectContext) {
            if (!args || typeof args.thread_id !== "string") {
                throw new Error("do_close: args.thread_id required");
            }
            if (!ctx.sessionId) throw new Error("do_close: no active sessionId");
            const selfName = nameFromUri(ctx.record.uri);
            const dir = threadDir(ctx.worldRoot, ctx.sessionId, selfName, args.thread_id);
            const jsonPath = path.join(dir, "thread.json");
            try {
                const body = await fs.readFile(jsonPath, "utf8");
                const obj = JSON.parse(body);
                obj.status = "closed";
                obj.closed_at = new Date().toISOString();
                await fs.writeFile(jsonPath, JSON.stringify(obj, null, 2));
            } catch {
                throw new Error(`do_close: thread not found or invalid: ${args.thread_id}`);
            }
            return { ok: true };
        },

        async todo_add(args: any, ctx: ObjectContext) {
            if (!args || typeof args.content !== "string") {
                throw new Error("todo_add: args.content required");
            }
            if (!ctx.sessionId) throw new Error("todo_add: no active sessionId");
            const selfName = nameFromUri(ctx.record.uri);
            await ensureFlowDir(ctx.worldRoot, ctx.sessionId, selfName);
            const f = todosFile(ctx.worldRoot, ctx.sessionId, selfName);
            let data: { items: any[] } = { items: [] };
            try {
                const body = await fs.readFile(f, "utf8");
                data = JSON.parse(body);
                if (!Array.isArray(data.items)) data.items = [];
            } catch { /* file 不存在或损坏 → 初始化 */ }
            const id = shortId("td");
            data.items.push({ id, content: args.content, checked: false, created_at: new Date().toISOString() });
            await fs.writeFile(f, JSON.stringify(data, null, 2));
            return { ok: true, id };
        },

        async todo_check(args: any, ctx: ObjectContext) {
            if (!args || typeof args.id !== "string") throw new Error("todo_check: args.id required");
            return await _mutateTodoChecked(ctx, args.id, true);
        },

        async todo_uncheck(args: any, ctx: ObjectContext) {
            if (!args || typeof args.id !== "string") throw new Error("todo_uncheck: args.id required");
            return await _mutateTodoChecked(ctx, args.id, false);
        },

        async todo_remove(args: any, ctx: ObjectContext) {
            if (!args || typeof args.id !== "string") throw new Error("todo_remove: args.id required");
            if (!ctx.sessionId) throw new Error("todo_remove: no active sessionId");
            const selfName = nameFromUri(ctx.record.uri);
            await ensureFlowDir(ctx.worldRoot, ctx.sessionId, selfName);
            const f = todosFile(ctx.worldRoot, ctx.sessionId, selfName);
            let data: { items: any[] } = { items: [] };
            try {
                data = JSON.parse(await fs.readFile(f, "utf8"));
                if (!Array.isArray(data.items)) data.items = [];
            } catch { return { ok: false, error: "no todos.json" }; }
            const before = data.items.length;
            data.items = data.items.filter((it: any) => it.id !== args.id);
            await fs.writeFile(f, JSON.stringify(data, null, 2));
            return { ok: data.items.length < before };
        },

        async todo_list(_args: any, ctx: ObjectContext) {
            if (!ctx.sessionId) throw new Error("todo_list: no active sessionId");
            const selfName = nameFromUri(ctx.record.uri);
            const f = todosFile(ctx.worldRoot, ctx.sessionId, selfName);
            try {
                const body = await fs.readFile(f, "utf8");
                const data = JSON.parse(body);
                return { ok: true, items: data.items ?? [] };
            } catch {
                return { ok: true, items: [] };
            }
        },

        async plan_set(args: any, ctx: ObjectContext) {
            if (typeof args?.text !== "string") throw new Error("plan_set: args.text required");
            if (!ctx.sessionId) throw new Error("plan_set: no active sessionId");
            const selfName = nameFromUri(ctx.record.uri);
            await ensureFlowDir(ctx.worldRoot, ctx.sessionId, selfName);
            await fs.writeFile(planFile(ctx.worldRoot, ctx.sessionId, selfName), args.text);
            return { ok: true };
        },

        async plan_clear(_args: any, ctx: ObjectContext) {
            if (!ctx.sessionId) throw new Error("plan_clear: no active sessionId");
            const selfName = nameFromUri(ctx.record.uri);
            try {
                await fs.unlink(planFile(ctx.worldRoot, ctx.sessionId, selfName));
            } catch { /* no plan → ok */ }
            return { ok: true };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async grep(args: any, _ctx: ObjectContext) {
            // TODO P6: 实装 ephemeral search Object 创建
            if (!args.pattern) throw new Error("grep: missing pattern");
            return { ok: true, status: "skeleton", _todo: "P6 implements ephemeral creation" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async glob(args: any, _ctx: ObjectContext) {
            if (!args.pattern) throw new Error("glob: missing pattern");
            return { ok: true, status: "skeleton", _todo: "P6" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async open_file(args: any, _ctx: ObjectContext) {
            if (!args.path) throw new Error("open_file: missing path");
            return { ok: true, status: "skeleton", _todo: "P6" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async open_knowledge(args: any, _ctx: ObjectContext) {
            if (!args.slug) throw new Error("open_knowledge: missing slug");
            return { ok: true, status: "skeleton", _todo: "P6" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async metaprog(args: any, _ctx: ObjectContext) {
            // TODO P8: 实装 super flow 协议
            if (!args.intent) throw new Error("metaprog: missing intent");
            return { ok: true, status: "skeleton", _todo: "P8 super flow" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async write_file(args: any, _ctx: ObjectContext) {
            if (!args.path) throw new Error("write_file: missing path");
            if (typeof args.content !== "string") throw new Error("write_file: content required");
            return { ok: true, status: "skeleton", _todo: "P5/P8: bounded write" };
        },

        async end(_args: unknown, _ctx: ObjectContext) {
            return { ok: true, status: "skeleton" };
        },
    },
    private: {
        // 暂无私有方法；defaultContext 是导出函数，由 dispatcher 在拼装上下文时调用，不需要进 private map。
    },
});

/* -------------------- internal helpers -------------------- */

async function readIfExists(p: string): Promise<string | null> {
    try {
        return await fs.readFile(p, "utf8");
    } catch {
        return null;
    }
}

async function directoryExists(p: string): Promise<boolean> {
    try {
        const stat = await fs.stat(p);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

async function listSubdirs(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
