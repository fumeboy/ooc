/**
 * stones/_builtin/objects/root/server/index.ts
 *
 * OOC-3 根原型的 server method 集合。
 *
 * P4 阶段: methods 是 skeleton (参数解析 + 占位返回 + TODO 标 P5)；
 *          defaultContext() 是真实实装（按 spec §3.5）。
 * P5 阶段: 11 个 B 类 method body 替换为真实 flow 层写入实装；
 *          其余 6 个 (grep/glob/open_file/open_knowledge/metaprog/write_file/end) 仍 skeleton (P6+)。
 * P8 阶段: pool_memory 切片 + memory_record method + metaprog 最小实装 + maxTokens 提升。
 * Round 10: repo_* methods — self-iteration capability (read/write repo source, tsc, tests, git).
 *
 * 详见 spec V2 §3 + meta/object.doc.ts:patches.b_class_collapse。
 */

import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
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

/* -------------------- REPO_ROOT detection (walk-up to .git) -------------------- */

function findRepoRoot(): string {
    let dir = path.resolve(process.cwd());
    while (true) {
        try {
            const stat = fsSync.statSync(path.join(dir, ".git"));
            if (stat.isDirectory() || stat.isFile()) return dir;
        } catch { /* not here */ }
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error("repo root not found (no .git ancestor)");
        dir = parent;
    }
}

const REPO_ROOT = findRepoRoot();

/* -------------------- defaultContext: 真实实装 -------------------- */

/**
 * defaultContext slice 结构：每轮 LLM 调用前拼装的 context 部分。
 */
export type DefaultContextSlice = {
    kind: "self_identity" | "plan" | "todos" | "threads" | "talks" | "relations" | "pool_memory";
    payload: unknown;
};

/**
 * Parse a minimal YAML frontmatter block (--- ... ---) for specific string keys.
 * Only handles simple `key: value` and `key: |\n  multi\n  line` forms.
 * Returns a record of found string values; does not throw.
 */
function parseFrontmatterFields(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!raw.startsWith("---")) return result;
    const endIdx = raw.indexOf("\n---", 3);
    if (endIdx === -1) return result;
    const fmBlock = raw.slice(4, endIdx); // skip opening "---\n"
    // Parse simple scalar: key: value (no quotes required)
    // and block scalar: key: |\n  line1\n  line2
    const lines = fmBlock.split("\n");
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
        if (!m) { i++; continue; }
        const key = m[1]!;
        const rest = m[2]!.trim();
        if (rest === "|") {
            // block scalar: collect indented lines
            const parts: string[] = [];
            i++;
            while (i < lines.length && (lines[i]!.startsWith("  ") || lines[i]!.trim() === "")) {
                parts.push(lines[i]!.replace(/^  /, ""));
                i++;
            }
            result[key] = parts.join("\n").trimEnd();
        } else {
            result[key] = rest;
            i++;
        }
    }
    return result;
}

/**
 * Build the self_identity slice from the Object's self.md file.
 * Reads title/description from self.md frontmatter directly (authoritative source),
 * then falls back to record.self for fields not in self.md.
 * Returns null if no title, description, or body is found.
 */
async function buildSelfIdentitySlice(ctx: ObjectContext): Promise<DefaultContextSlice | null> {
    const record = ctx.record;
    const recordFm = record.self ?? {};

    // Start with record.self as fallback
    let title = typeof recordFm.title === "string" ? recordFm.title : undefined;
    let description = typeof recordFm.description === "string" ? recordFm.description : undefined;
    let body = "";

    if (record.paths.stone) {
        const selfMdPath = path.join(record.paths.stone, "self.md");
        try {
            const raw = await fs.readFile(selfMdPath, "utf8");
            // Parse frontmatter for title/description (overrides record.self)
            const fm = parseFrontmatterFields(raw);
            if (fm.title) title = fm.title;
            if (fm.description) description = fm.description;
            // Extract body (after closing ---)
            if (raw.startsWith("---")) {
                const endIdx = raw.indexOf("\n---", 3);
                if (endIdx >= 0) {
                    body = raw.slice(endIdx + 4).replace(/^\n+/, "");
                }
            } else {
                body = raw;
            }
            if (body.length > 1500) body = body.slice(0, 1500) + "\n[...truncated...]";
        } catch {
            // self.md missing or unreadable; just use record.self frontmatter
        }
    }

    if (!title && !description && !body) return null;

    return {
        kind: "self_identity",
        payload: { title, description, body },
    };
}

/**
 * defaultContext(): 从 active flow 读取并拼装当前 Object 的 context 切片。
 *
 * 子原型可 override 加自己的切片。
 */
export async function defaultContext(ctx: ObjectContext): Promise<DefaultContextSlice[]> {
    const slices: DefaultContextSlice[] = [];

    // 0. self_identity: always inject first (highest LLM attention priority)
    const selfIdentity = await buildSelfIdentitySlice(ctx);
    if (selfIdentity) slices.push(selfIdentity);

    const flowPath = ctx.record.paths.flow;
    if (!flowPath) {
        // 无 active flow → only self_identity (if any) + relations (从 stone 推导)
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

    // 6. pool_memory: 跨 session 沉淀知识（pools/objects/<self>/knowledge/memory/*.md）
    const poolMemoryItems = await loadPoolMemory(ctx);
    if (poolMemoryItems.length > 0) {
        slices.push({ kind: "pool_memory", payload: poolMemoryItems });
    }

    return slices;
}

/**
 * 计算 pool memory 目录：pools/objects/<selfName>/knowledge/memory/
 * 优先使用 ctx.record.paths.pool；否则合成。
 */
function poolMemoryDirForCtx(ctx: ObjectContext): string {
    const selfName = nameFromUri(ctx.record.uri);
    const poolBase = ctx.record.paths.pool
        ?? path.join(ctx.worldRoot, "pools", "objects", selfName);
    return path.join(poolBase, "knowledge", "memory");
}

/**
 * 读取 pool_memory 目录下所有 .md 文件，返回 { slug, content } 数组。
 * - 跳过目录不存在的情况
 * - 每个文件不超过 PER_FILE_LIMIT (2000) 字符，防止单个大文件饿死其他
 * - 总字符数不超过 MAX_CHARS (8000)
 */
async function loadPoolMemory(ctx: ObjectContext): Promise<Array<{ slug: string; content: string }>> {
    const memDir = poolMemoryDirForCtx(ctx);
    if (!(await directoryExists(memDir))) return [];

    const entries = await fs.readdir(memDir, { withFileTypes: true }).catch(() => []);
    const result: Array<{ slug: string; content: string }> = [];
    let totalChars = 0;
    const MAX_CHARS = 8000;
    const PER_FILE_LIMIT = 2000;

    for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith(".md")) continue;
        const slug = e.name.replace(/\.md$/, "");
        const rawContent = await readIfExists(path.join(memDir, e.name));
        if (!rawContent) continue;
        // Strip YAML frontmatter (--- ... ---\n\n) before exposing to LLM
        const content = stripFrontmatter(rawContent);
        // First, cap each file to PER_FILE_LIMIT independently so one large file
        // can't consume the entire budget.
        const perFileTrimmed = content.slice(0, PER_FILE_LIMIT);
        // Then, fit within remaining total budget.
        const remaining = MAX_CHARS - totalChars;
        if (remaining <= 0) break;
        const trimmed = perFileTrimmed.slice(0, remaining);
        result.push({ slug, content: trimmed });
        totalChars += trimmed.length;
        if (totalChars >= MAX_CHARS) break;
    }

    return result;
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

        /**
         * do(): Skeleton — creates a thread record (intent.md + thread.json) in the flow layer
         * to express the intent of a sub-task, but does NOT automatically spawn a worker to
         * execute it. Full sub-thread worker loop is P6+ infrastructure work.
         * Use do_close() to mark a thread as closed once the intent is fulfilled externally.
         */
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
            return { ok: true, thread_id: threadId, _note: "thread record created; worker execution requires P6+ sub-thread loop" };
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

        async memory_record(args: any, ctx: ObjectContext) {
            if (!args || typeof args.slug !== "string" || args.slug.trim() === "") {
                throw new Error("memory_record: args.slug (non-empty string) required");
            }
            if (typeof args.content !== "string") {
                throw new Error("memory_record: args.content (string) required");
            }
            // Normalize slug to kebab-case: lowercase, replace spaces/underscores with hyphens, strip unsafe chars
            const slug = args.slug.trim()
                .toLowerCase()
                .replace(/[\s_]+/g, "-")
                .replace(/[^a-z0-9\-]/g, "")
                .replace(/-+/g, "-")
                .replace(/^-|-$/g, "");
            if (!slug) throw new Error("memory_record: slug normalizes to empty string");
            const memDir = poolMemoryDirForCtx(ctx);
            await fs.mkdir(memDir, { recursive: true });
            const filePath = path.join(memDir, `${slug}.md`);
            // Wrap content with YAML frontmatter for audit metadata
            const frontmatter = [
                "---",
                `created_at: ${new Date().toISOString()}`,
                `session_id: ${ctx.sessionId ?? ""}`,
                `object_uri: ${ctx.record.uri}`,
                "---",
                "",
            ].join("\n");
            await fs.writeFile(filePath, frontmatter + args.content);
            return { ok: true, slug, path: filePath };
        },

        async grep(args: any, ctx: ObjectContext) {
            if (!args?.pattern) throw new Error("grep: args.pattern required");
            const searchDir = args.path
                ? path.resolve(ctx.worldRoot, args.path)
                : ctx.worldRoot;
            const resolved = searchDir;
            if (!resolved.startsWith(path.resolve(ctx.worldRoot)) && resolved !== path.resolve(ctx.worldRoot)) {
                throw new Error(`grep: path outside worldRoot: ${args.path}`);
            }
            const results: Array<{ file: string; line: number; content: string }> = [];
            const maxFiles = 200;
            const maxMatches = 100;
            let filesScanned = 0;
            const re = new RegExp(args.pattern, "i");
            async function walk(dir: string): Promise<void> {
                if (results.length >= maxMatches) return;
                if (filesScanned >= maxFiles) return;
                const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
                for (const e of entries) {
                    if (results.length >= maxMatches || filesScanned >= maxFiles) return;
                    if (e.name.startsWith(".") || e.name === "node_modules") continue;
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) { await walk(full); continue; }
                    if (e.isFile()) {
                        filesScanned++;
                        try {
                            const body = await fs.readFile(full, "utf8");
                            const lines = body.split("\n");
                            for (let i = 0; i < lines.length; i++) {
                                if (re.test(lines[i]!)) {
                                    results.push({ file: full, line: i + 1, content: lines[i]!.slice(0, 200) });
                                    if (results.length >= maxMatches) return;
                                }
                            }
                        } catch { /* skip binary or unreadable */ }
                    }
                }
            }
            await walk(resolved);

            // §3.4: create ephemeral search Object in flows/<sessionId>/objects/search_<hash>/
            if (ctx.sessionId) {
                const objectId = `search_${shortId()}`;
                const objectDir = path.join(ctx.worldRoot, "flows", ctx.sessionId, "objects", objectId);
                await fs.mkdir(objectDir, { recursive: true });
                // Write self.md with frontmatter identifying this ephemeral instance
                const selfMd = [
                    "---",
                    "extends: search",
                    `pattern: ${JSON.stringify(args.pattern)}`,
                    `path: ${JSON.stringify(args.path ?? ctx.worldRoot)}`,
                    `created_at: ${new Date().toISOString()}`,
                    "---",
                    "",
                    `# search_result`,
                    "",
                    `Pattern: \`${args.pattern}\`  `,
                    `Path: \`${args.path ?? ctx.worldRoot}\`  `,
                    `Matches: ${results.length}`,
                ].join("\n");
                await fs.writeFile(path.join(objectDir, "self.md"), selfMd);
                // Write results.json (all results, not just top 50)
                await fs.writeFile(
                    path.join(objectDir, "results.json"),
                    JSON.stringify({ pattern: args.pattern, path: args.path ?? ctx.worldRoot, count: results.length, results }, null, 2),
                );
                // Register ephemeral Object in registry so subsequent calls can find it
                const ephemeralUri = `ooc://flows/${ctx.sessionId}/objects/${objectId}`;
                ctx.registry.set({
                    uri: ephemeralUri,
                    paths: { flow: objectDir },
                    kind: "ephemeral",
                    self: { extends: "search", pattern: args.pattern, path: args.path ?? ctx.worldRoot },
                });
                return { ok: true, uri: ephemeralUri, count: results.length, results: results.slice(0, 10) };
            }

            return { ok: true, count: results.length, results: results.slice(0, 50) };
        },

        async glob(args: any, ctx: ObjectContext) {
            if (!args?.pattern) throw new Error("glob: args.pattern required");
            const searchDir = args.path
                ? path.resolve(ctx.worldRoot, args.path)
                : ctx.worldRoot;
            const resolved = searchDir;
            if (!resolved.startsWith(path.resolve(ctx.worldRoot))) {
                throw new Error(`glob: path outside worldRoot`);
            }
            const patternStr = String(args.pattern);
            const matches: string[] = [];
            const maxMatches = 200;
            async function walk(dir: string): Promise<void> {
                if (matches.length >= maxMatches) return;
                const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
                for (const e of entries) {
                    if (e.name.startsWith(".") || e.name === "node_modules") continue;
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) { await walk(full); }
                    else if (e.isFile() && fileMatchesPattern(e.name, patternStr)) {
                        matches.push(full);
                        if (matches.length >= maxMatches) return;
                    }
                }
            }
            await walk(resolved);

            // §3.4: create ephemeral glob Object in flows/<sessionId>/objects/glob_<hash>/
            if (ctx.sessionId) {
                const objectId = `glob_${shortId()}`;
                const objectDir = path.join(ctx.worldRoot, "flows", ctx.sessionId, "objects", objectId);
                await fs.mkdir(objectDir, { recursive: true });
                // Write self.md with frontmatter identifying this ephemeral instance
                const selfMd = [
                    "---",
                    "extends: glob",
                    `pattern: ${JSON.stringify(args.pattern)}`,
                    `path: ${JSON.stringify(args.path ?? ctx.worldRoot)}`,
                    `created_at: ${new Date().toISOString()}`,
                    "---",
                    "",
                    `# glob_result`,
                    "",
                    `Pattern: \`${args.pattern}\`  `,
                    `Path: \`${args.path ?? ctx.worldRoot}\`  `,
                    `Matches: ${matches.length}`,
                ].join("\n");
                await fs.writeFile(path.join(objectDir, "self.md"), selfMd);
                // Write matches.json with all matching file paths
                await fs.writeFile(
                    path.join(objectDir, "matches.json"),
                    JSON.stringify({ pattern: args.pattern, path: args.path ?? ctx.worldRoot, count: matches.length, files: matches }, null, 2),
                );
                // Register ephemeral Object in registry so subsequent calls can find it
                const ephemeralUri = `ooc://flows/${ctx.sessionId}/objects/${objectId}`;
                ctx.registry.set({
                    uri: ephemeralUri,
                    paths: { flow: objectDir },
                    kind: "ephemeral",
                    self: { extends: "glob", pattern: args.pattern, path: args.path ?? ctx.worldRoot },
                });
                return { ok: true, uri: ephemeralUri, count: matches.length, files: matches };
            }

            return { ok: true, count: matches.length, files: matches };
        },

        async open_file(args: any, ctx: ObjectContext) {
            if (!args?.path) throw new Error("open_file: args.path required");
            const target = path.resolve(ctx.worldRoot, args.path);
            if (!target.startsWith(path.resolve(ctx.worldRoot))) {
                throw new Error(`open_file: path outside worldRoot: ${args.path}`);
            }
            const body = await fs.readFile(target, "utf8");
            const maxBytes = 50_000;
            if (body.length > maxBytes) {
                return { ok: true, path: args.path, truncated: true, content: body.slice(0, maxBytes), bytes: body.length };
            }
            return { ok: true, path: args.path, content: body, bytes: body.length };
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async open_knowledge(args: any, _ctx: ObjectContext) {
            if (!args.slug) throw new Error("open_knowledge: missing slug");
            return { ok: true, status: "skeleton", _todo: "P6" };
        },

        async metaprog(args: any, ctx: ObjectContext) {
            if (!args.intent) throw new Error("metaprog: args.intent required");
            if (!args.target_file || typeof args.target_file !== "string") {
                throw new Error("metaprog: args.target_file (string, relative to object stone dir) required");
            }
            // Determine the object's stone dir for this branch.
            // URI: ooc://stones/<branch>/objects/<name>
            const uri = ctx.record.uri;
            const stoneDir = ctx.record.paths.stone;
            if (!stoneDir) {
                throw new Error("metaprog: no stone path for this object");
            }
            // Safety: target_file must resolve within stones/<branch>/objects/<selfName>/
            const resolved = path.resolve(stoneDir, args.target_file);
            if (!resolved.startsWith(path.resolve(stoneDir))) {
                throw new Error(`metaprog: target_file must be within stone dir (${stoneDir})`);
            }
            const content = await readIfExists(resolved);
            if (content === null) {
                // File doesn't exist yet; return empty content so LLM can create it via write_file
                return {
                    ok: true,
                    intent: args.intent,
                    target_file: args.target_file,
                    resolved_path: resolved,
                    current_content: null,
                    instruction: `The file does not exist yet. Use write_file with path="${resolved}" to create it with the desired content.`,
                };
            }
            return {
                ok: true,
                intent: args.intent,
                target_file: args.target_file,
                resolved_path: resolved,
                current_content: content,
                instruction: `Review the current content above. Then use write_file with path="${resolved}" to update the file with the requested changes (intent: ${args.intent}).`,
            };
        },

        async write_file(args: any, ctx: ObjectContext) {
            if (!args?.path) throw new Error("write_file: args.path required");
            if (typeof args.content !== "string") throw new Error("write_file: args.content (string) required");
            // Relative paths resolve relative to worldRoot.
            // Absolute paths are allowed only within worldRoot OR within stone dir (metaprog workflow).
            let target: string;
            if (path.isAbsolute(args.path)) {
                target = path.normalize(args.path);
                const resolvedWorld = path.resolve(ctx.worldRoot);
                const stoneDir = ctx.record.paths.stone;
                const withinWorld = target.startsWith(resolvedWorld + path.sep) || target === resolvedWorld;
                const withinStone = stoneDir && (target.startsWith(path.resolve(stoneDir) + path.sep) || target === path.resolve(stoneDir));
                if (!withinWorld && !withinStone) {
                    throw new Error(`write_file: absolute path must be within worldRoot or stone dir: ${args.path}`);
                }
                if (withinStone && !withinWorld) {
                    // Audit log: writing to stone path via metaprog workflow
                    console.log(`[write_file:stone] ${ctx.record.uri} → ${target}`);
                }
            } else {
                target = path.resolve(ctx.worldRoot, args.path);
                if (!target.startsWith(path.resolve(ctx.worldRoot))) {
                    throw new Error(`write_file: path outside worldRoot: ${args.path}`);
                }
            }
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, args.content);
            return { ok: true, path: args.path, bytes: Buffer.byteLength(args.content) };
        },

        async exec_command(args: any, ctx: ObjectContext) {
            if (!args?.command || !Array.isArray(args.command) || args.command.length === 0) {
                throw new Error("exec_command: args.command (string[]) required and non-empty");
            }
            const cmd = args.command.map((s: any) => String(s));
            const cwd = args.cwd ? path.resolve(ctx.worldRoot, args.cwd) : ctx.worldRoot;
            if (!cwd.startsWith(path.resolve(ctx.worldRoot))) {
                throw new Error(`exec_command: cwd outside worldRoot: ${args.cwd}`);
            }
            const timeoutMs = typeof args.timeout_ms === "number" ? Math.min(args.timeout_ms, 60_000) : 15_000;
            const stdinInput = typeof args.stdin === "string" ? args.stdin : undefined;

            try {
                const proc = Bun.spawn({
                    cmd,
                    cwd,
                    stdout: "pipe",
                    stderr: "pipe",
                    stdin: stdinInput !== undefined ? Buffer.from(stdinInput) : "ignore",
                    env: { ...process.env, PATH: process.env.PATH ?? "/usr/bin:/bin" },
                });

                // Race with timeout
                const exitCode = await Promise.race([
                    proc.exited,
                    new Promise<number>((_, rej) =>
                        setTimeout(() => { proc.kill(); rej(new Error(`exec_command: timeout after ${timeoutMs}ms`)); }, timeoutMs),
                    ),
                ]).catch((err) => {
                    return { _timeoutErr: err };
                });

                if (typeof exitCode === "object" && exitCode && "_timeoutErr" in exitCode) {
                    const stdoutText = await new Response(proc.stdout as any).text().catch(() => "");
                    const stderrText = await new Response(proc.stderr as any).text().catch(() => "");
                    return { ok: false, error: "timeout", stdout: stdoutText.slice(0, 4000), stderr: stderrText.slice(0, 4000) };
                }

                const stdoutText = await new Response(proc.stdout as any).text().catch(() => "");
                const stderrText = await new Response(proc.stderr as any).text().catch(() => "");
                return {
                    ok: exitCode === 0,
                    exit_code: exitCode,
                    stdout: stdoutText.slice(0, 8000),
                    stderr: stderrText.slice(0, 4000),
                };
            } catch (err) {
                throw new Error(`exec_command failed: ${(err as Error).message}`);
            }
        },

        async end(_args: unknown, _ctx: ObjectContext) {
            // Returns a sentinel that thinkloop checks to terminate the thread.
            // Call this after sending your final reply via talk().
            return { ok: true, __ooc_thread_action: "end" };
        },

        /* -------------------- repo_* methods: self-iteration capability -------------------- */

        async repo_read(args: any, _ctx: ObjectContext) {
            if (!args?.path || typeof args.path !== "string" || args.path.trim() === "") {
                throw new Error("repo_read: args.path (non-empty string) required");
            }
            const target = path.resolve(REPO_ROOT, args.path);
            if (!target.startsWith(REPO_ROOT + path.sep) && target !== REPO_ROOT) {
                throw new Error(`repo_read: path outside repo root: ${args.path}`);
            }
            const body = await fs.readFile(target, "utf8");
            const allLines = body.split("\n");
            const lines_total = allLines.length;

            // Default line cap: if no `lines` parameter provided and file > DEFAULT_MAX_LINES,
            // auto-truncate to first DEFAULT_MAX_LINES lines to prevent analysis-paralysis from
            // reading massive files. Use lines:[start,end] to read a specific range.
            const DEFAULT_MAX_LINES = 200;

            // Optional `lines: [start, end]` partial-read (1-indexed, inclusive).
            // Out-of-range values clamp silently. Always returns lines_total so
            // callers can navigate large files without re-reading.
            // Maximum range per single read is capped at 500 lines.
            if (Array.isArray(args.lines) && args.lines.length === 2) {
                const MAX_EXPLICIT_RANGE = 500;
                const rawStart = Number(args.lines[0]);
                const rawEnd = Number(args.lines[1]);
                if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
                    throw new Error("repo_read: args.lines must be [number, number]");
                }
                // Clamp to [1, total]; if start > end, swap silently.
                let startN = Math.max(1, Math.floor(rawStart));
                let endN = Math.max(1, Math.floor(rawEnd));
                if (startN > endN) { const t = startN; startN = endN; endN = t; }
                startN = Math.min(startN, lines_total);
                endN = Math.min(endN, lines_total);
                // Cap range to 500 lines max per read.
                if (endN - startN + 1 > MAX_EXPLICIT_RANGE) {
                    endN = startN + MAX_EXPLICIT_RANGE - 1;
                    endN = Math.min(endN, lines_total);
                }
                const sliced = allLines.slice(startN - 1, endN).join("\n");
                return {
                    ok: true,
                    path: target,
                    content: sliced,
                    bytes: Buffer.byteLength(sliced),
                    lines: [startN, endN],
                    lines_total,
                };
            }

            // No explicit lines range: auto-truncate to DEFAULT_MAX_LINES if file is larger.
            if (lines_total > DEFAULT_MAX_LINES) {
                const truncatedContent = allLines.slice(0, DEFAULT_MAX_LINES).join("\n");
                return {
                    ok: true,
                    path: target,
                    truncated: true,
                    content: truncatedContent,
                    bytes: body.length,
                    lines_total,
                    _note: `auto-truncated to first ${DEFAULT_MAX_LINES} lines; use lines:[start,end] to read more (max 500 per read)`,
                };
            }

            return { ok: true, path: target, content: body, bytes: body.length, lines_total };
        },

        async repo_search(args: any, _ctx: ObjectContext) {
            if (!args?.pattern || typeof args.pattern !== "string" || args.pattern === "") {
                throw new Error("repo_search: args.pattern (non-empty string) required");
            }
            let regex: RegExp;
            try {
                regex = new RegExp(args.pattern);
            } catch (err) {
                throw new Error(`repo_search: invalid regex pattern: ${(err as Error).message}`);
            }
            const maxResults = (typeof args.max_results === "number" && args.max_results > 0)
                ? Math.floor(args.max_results)
                : 100;

            // Resolve and validate scan root.
            const scanRoot = args?.path && typeof args.path === "string" && args.path.trim() !== ""
                ? path.resolve(REPO_ROOT, args.path)
                : REPO_ROOT;
            if (!scanRoot.startsWith(REPO_ROOT + path.sep) && scanRoot !== REPO_ROOT) {
                throw new Error(`repo_search: path outside repo root: ${args.path}`);
            }

            const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".ooc-world"]);
            const matches: Array<{ file: string; line: number; content: string }> = [];
            let total = 0;

            async function walk(dir: string): Promise<void> {
                if (matches.length >= maxResults) return;
                let entries: import("node:fs").Dirent[];
                try {
                    entries = await fs.readdir(dir, { withFileTypes: true });
                } catch {
                    return;
                }
                for (const ent of entries) {
                    if (matches.length >= maxResults) return;
                    if (ent.isDirectory()) {
                        if (SKIP_DIRS.has(ent.name)) continue;
                        await walk(path.join(dir, ent.name));
                        continue;
                    }
                    if (!ent.isFile()) continue;
                    const filePath = path.join(dir, ent.name);
                    let body: string;
                    try {
                        body = await fs.readFile(filePath, "utf8");
                    } catch {
                        continue; // binary or unreadable; skip
                    }
                    // Heuristic: skip files containing NUL bytes (binary).
                    if (body.indexOf("\u0000") !== -1) continue;
                    const lines = body.split("\n");
                    for (let i = 0; i < lines.length; i++) {
                        if (regex.test(lines[i] ?? "")) {
                            total++;
                            if (matches.length < maxResults) {
                                matches.push({
                                    file: path.relative(REPO_ROOT, filePath),
                                    line: i + 1,
                                    content: (lines[i] ?? "").slice(0, 500),
                                });
                            }
                        }
                    }
                }
            }

            const stat = await fs.stat(scanRoot).catch(() => null);
            if (stat?.isFile()) {
                const body = await fs.readFile(scanRoot, "utf8");
                const lines = body.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i] ?? "")) {
                        total++;
                        if (matches.length < maxResults) {
                            matches.push({
                                file: path.relative(REPO_ROOT, scanRoot),
                                line: i + 1,
                                content: (lines[i] ?? "").slice(0, 500),
                            });
                        }
                    }
                }
            } else {
                await walk(scanRoot);
            }

            return { ok: true, matches, total };
        },

        async repo_write(args: any, ctx: ObjectContext) {
            if (!args?.path || typeof args.path !== "string" || args.path.trim() === "") {
                throw new Error("repo_write: args.path (non-empty string) required");
            }
            if (typeof args.content !== "string") {
                throw new Error("repo_write: args.content (string) required");
            }
            const target = path.resolve(REPO_ROOT, args.path);
            if (!target.startsWith(REPO_ROOT + path.sep) && target !== REPO_ROOT) {
                throw new Error(`repo_write: path outside repo root: ${args.path}`);
            }
            const rel = path.relative(REPO_ROOT, target);
            if (rel === ".git" || rel.startsWith(".git" + path.sep) || rel.startsWith(".git/") || rel.startsWith(".git\\")) {
                throw new Error(`repo_write: path inside .git/ is not allowed: ${args.path}`);
            }
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, args.content);
            const bytes = Buffer.byteLength(args.content);

            // Audit log: flows/<sessionId>/objects/<self>/repo-writes.jsonl
            if (ctx.sessionId) {
                const selfName = nameFromUri(ctx.record.uri);
                const auditDir = path.join(ctx.worldRoot, "flows", ctx.sessionId, "objects", selfName);
                await fs.mkdir(auditDir, { recursive: true });
                const auditEntry = JSON.stringify({ ts: new Date().toISOString(), path: target, bytes }) + "\n";
                await fs.appendFile(path.join(auditDir, "repo-writes.jsonl"), auditEntry);
            }

            return { ok: true, path: target, bytes };
        },

        async repo_run_tests(args: any, _ctx: ObjectContext) {
            const cmd = ["bun", "test"];
            if (args?.pattern && typeof args.pattern === "string") {
                cmd.push(args.pattern);
            }
            const timeoutMs = 120_000;
            try {
                const proc = Bun.spawn({
                    cmd,
                    cwd: REPO_ROOT,
                    stdout: "pipe",
                    stderr: "pipe",
                    env: { ...process.env, PATH: process.env.PATH ?? "/usr/bin:/bin" },
                });
                const exitCode = await Promise.race([
                    proc.exited,
                    new Promise<number>((_, rej) =>
                        setTimeout(() => { proc.kill(); rej(new Error("repo_run_tests: timeout")); }, timeoutMs),
                    ),
                ]);
                const maxBytes = 8_192;
                const stdoutText = (await new Response(proc.stdout as any).text().catch(() => "")).slice(0, maxBytes);
                const stderrText = (await new Response(proc.stderr as any).text().catch(() => "")).slice(0, maxBytes);
                return { ok: exitCode === 0, exit_code: exitCode, stdout: stdoutText, stderr: stderrText };
            } catch (err) {
                return { ok: false, exit_code: -1, stdout: "", stderr: String((err as Error).message) };
            }
        },

        async repo_run_tsc(_args: any, _ctx: ObjectContext) {
            const timeoutMs = 60_000;
            try {
                const proc = Bun.spawn({
                    cmd: ["bunx", "tsc", "--noEmit"],
                    cwd: REPO_ROOT,
                    stdout: "pipe",
                    stderr: "pipe",
                    env: { ...process.env, PATH: process.env.PATH ?? "/usr/bin:/bin" },
                });
                const exitCode = await Promise.race([
                    proc.exited,
                    new Promise<number>((_, rej) =>
                        setTimeout(() => { proc.kill(); rej(new Error("repo_run_tsc: timeout")); }, timeoutMs),
                    ),
                ]);
                const maxBytes = 8_192;
                const stdoutText = (await new Response(proc.stdout as any).text().catch(() => "")).slice(0, maxBytes);
                const stderrText = (await new Response(proc.stderr as any).text().catch(() => "")).slice(0, maxBytes);
                const combined = (stdoutText + stderrText);
                const errorsCount = (combined.match(/error TS\d+/g) ?? []).length;
                return { ok: exitCode === 0, exit_code: exitCode, errors_count: errorsCount, output: combined };
            } catch (err) {
                return { ok: false, exit_code: -1, errors_count: -1, output: String((err as Error).message) };
            }
        },

        async repo_git_diff(args: any, _ctx: ObjectContext) {
            const cmd = ["git", "diff"];
            if (args?.path && typeof args.path === "string") {
                const target = path.resolve(REPO_ROOT, args.path);
                if (!target.startsWith(REPO_ROOT + path.sep) && target !== REPO_ROOT) {
                    throw new Error(`repo_git_diff: path outside repo root: ${args.path}`);
                }
                cmd.push("--", target);
            }
            try {
                const proc = Bun.spawnSync({
                    cmd,
                    cwd: REPO_ROOT,
                    stdout: "pipe",
                    stderr: "pipe",
                });
                const diff = (proc.stdout?.toString() ?? "").slice(0, 16_384);
                return { ok: proc.exitCode === 0, diff };
            } catch (err) {
                return { ok: false, diff: "", error: String((err as Error).message) };
            }
        },

        async repo_git_status(_args: any, _ctx: ObjectContext) {
            try {
                const proc = Bun.spawnSync({
                    cmd: ["git", "status", "--short"],
                    cwd: REPO_ROOT,
                    stdout: "pipe",
                    stderr: "pipe",
                });
                return { ok: proc.exitCode === 0, status: proc.stdout?.toString() ?? "" };
            } catch (err) {
                return { ok: false, status: "", error: String((err as Error).message) };
            }
        },

        async repo_git_commit(args: any, ctx: ObjectContext) {
            if (!args?.message || typeof args.message !== "string" || args.message.trim() === "") {
                throw new Error("repo_git_commit: args.message (non-empty string) required");
            }
            // Mandatory [ooc-iteration] prefix
            let message = args.message.trim();
            if (!message.startsWith("[ooc-iteration]")) {
                message = `[ooc-iteration] ${message}`;
            }
            // Append Iterated-By footer
            const selfUri = ctx.record.uri;
            message = `${message}\n\nIterated-By: ${selfUri}`;

            // Stage files
            const addArgs = (Array.isArray(args.files) && args.files.length > 0)
                ? args.files.map((f: any) => String(f))
                : ["."];
            try {
                const addProc = Bun.spawnSync({
                    cmd: ["git", "add", ...addArgs],
                    cwd: REPO_ROOT,
                    stdout: "pipe",
                    stderr: "pipe",
                });
                if (addProc.exitCode !== 0) {
                    return { ok: false, commit_sha: null, message, error: addProc.stderr?.toString() ?? "git add failed" };
                }

                const commitProc = Bun.spawnSync({
                    cmd: ["git", "commit", "-m", message],
                    cwd: REPO_ROOT,
                    stdout: "pipe",
                    stderr: "pipe",
                });
                if (commitProc.exitCode !== 0) {
                    return { ok: false, commit_sha: null, message, error: commitProc.stderr?.toString() ?? "git commit failed" };
                }

                // Extract commit SHA from output
                const out = commitProc.stdout?.toString() ?? "";
                const shaMatch = out.match(/\[[\w\-]+ ([0-9a-f]{7,})\]/);
                const commit_sha = shaMatch ? shaMatch[1] : null;
                return { ok: true, commit_sha, message };
            } catch (err) {
                return { ok: false, commit_sha: null, message, error: String((err as Error).message) };
            }
        },
    },
    private: {
        // 暂无私有方法；defaultContext 是导出函数，由 dispatcher 在拼装上下文时调用，不需要进 private map。
    },
});

/* -------------------- internal helpers -------------------- */

/**
 * Simple file name pattern matching for glob:
 * - *.ext → matches any file ending with .ext
 * - **\/*.ext or **\/*.ext → same (** prefix is stripped; we always walk recursively)
 * - otherwise: exact name match or substring match
 */
function fileMatchesPattern(name: string, pattern: string): boolean {
    // strip leading **/ or ** prefix
    const cleaned = pattern.replace(/^\*\*\//, "").replace(/^\*\*/, "*");
    if (cleaned.startsWith("*.")) {
        return name.endsWith(cleaned.slice(1));
    }
    return name === cleaned || name.includes(cleaned);
}

/**
 * Strip YAML frontmatter (--- ... ---\n) from a markdown string.
 * Returns the body after the closing --- delimiter, or the full string if no frontmatter.
 */
function stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;
    const second = content.indexOf("\n---", 3);
    if (second === -1) return content;
    // Skip past the closing --- and any following newlines
    return content.slice(second + 4).replace(/^\n/, "");
}

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
