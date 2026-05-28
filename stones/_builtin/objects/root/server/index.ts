/**
 * stones/_builtin/objects/root/server/index.ts
 *
 * OOC-3 根原型的 server method 集合。
 *
 * P4 阶段: methods 是 skeleton (参数解析 + 占位返回 + TODO 标 P5)；
 *          defaultContext() 是真实实装（按 spec §3.5）。
 *
 * 详见 spec V2 §3 + meta/object.doc.ts:patches.b_class_collapse。
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defineObject, type ObjectContext } from "@src/executable/server";

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

/* -------------------- public methods: skeletons (P5 fill in) -------------------- */

export default defineObject({
    public: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async talk(args: any, _ctx: ObjectContext) {
            // TODO P5: 实装 flow 层双端 talks/<peer>.jsonl append + 唤起 target LLM
            if (!args.target || !args.content) {
                throw new Error("talk: missing target or content");
            }
            return { ok: true, status: "skeleton", _todo: "P5 implements talk-直投回路" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async do(args: any, _ctx: ObjectContext) {
            // TODO P5: 实装 flow 层 threads/<id>/ 创建 + spawn sub-thread worker
            if (!args.intent) throw new Error("do: missing intent");
            return { ok: true, status: "skeleton", thread_id: "stub_" + String(Date.now()) };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async do_close(args: any, _ctx: ObjectContext) {
            if (!args.thread_id) throw new Error("do_close: missing thread_id");
            return { ok: true, status: "skeleton" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async todo_add(args: any, _ctx: ObjectContext) {
            if (!args.content) throw new Error("todo_add: missing content");
            return { ok: true, status: "skeleton", id: "stub_" + String(Date.now()) };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async todo_check(args: any, _ctx: ObjectContext) {
            if (!args.id) throw new Error("todo_check: missing id");
            return { ok: true, status: "skeleton" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async todo_uncheck(args: any, _ctx: ObjectContext) {
            if (!args.id) throw new Error("todo_uncheck: missing id");
            return { ok: true, status: "skeleton" };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async todo_remove(args: any, _ctx: ObjectContext) {
            if (!args.id) throw new Error("todo_remove: missing id");
            return { ok: true, status: "skeleton" };
        },

        async todo_list(_args: unknown, _ctx: ObjectContext) {
            return { ok: true, status: "skeleton", items: [] as unknown[] };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async plan_set(args: any, _ctx: ObjectContext) {
            if (typeof args.text !== "string") throw new Error("plan_set: text required");
            return { ok: true, status: "skeleton" };
        },

        async plan_clear(_args: unknown, _ctx: ObjectContext) {
            return { ok: true, status: "skeleton" };
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
