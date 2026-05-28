/**
 * flow-paths: 一次 session 内 Object 的 flow 层路径计算与 auto-create。
 *
 * 详见 spec §2.1 (persistent Object flow 层结构) + §3.2-§3.5 (B 类字段路径)。
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * 计算 Object 在指定 session 内的 flow 目录路径。
 *
 * 例:
 * - flowObjectDir("/world", "s_abc", "agent_a") → /world/flows/s_abc/objects/agent_a
 *
 * 不 mkdir；纯字符串。
 */
export function flowObjectDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(worldRoot, "flows", sessionId, "objects", objectName);
}

/**
 * 从 ooc:// URI 抽取 Object 的 "name"（最后一段或 children/<name> 的尾段）。
 *
 * 用于 persistent Object: ooc://stones/main/objects/foo → "foo"
 * 用于 persistent child:  ooc://stones/main/objects/foo/children/bar → "bar"（仅取末尾）
 * 用于 ephemeral:         ooc://flows/<s>/objects/search_xy → "search_xy"
 */
export function nameFromUri(uri: string): string {
    const segments = uri.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1];
}

/**
 * 确保 Object 在指定 session 的 flow 目录存在；返回该目录绝对路径。
 *
 * persistent Object 在 session 内被 talk 到时由此函数 lazy 创建 flow 目录。
 */
export async function ensureFlowDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): Promise<string> {
    const dir = flowObjectDir(worldRoot, sessionId, objectName);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/* -------------------- talks/<peer>.jsonl -------------------- */

/**
 * 把 peer URI 转为安全的 slug 用作文件名。
 *
 * 简化策略: 去除 ooc:// 前缀后把 "/" 替换为 "__"。
 * 必须保证可逆 (后续 UI 渲染需要)。
 */
export function peerSlugFromUri(peerUri: string): string {
    return peerUri.replace(/^ooc:\/\//, "").replace(/\//g, "__");
}

/**
 * 逆操作: slug → peer URI（用于 UI 加载）。
 */
export function peerUriFromSlug(slug: string): string {
    return "ooc://" + slug.replace(/__/g, "/");
}

export function talksDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(flowObjectDir(worldRoot, sessionId, objectName), "talks");
}

export function talksFile(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    peerUri: string,
): string {
    return path.join(
        talksDir(worldRoot, sessionId, objectName),
        peerSlugFromUri(peerUri) + ".jsonl",
    );
}

export async function ensureTalksDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): Promise<string> {
    const dir = talksDir(worldRoot, sessionId, objectName);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/**
 * 单条 talk 消息记录。
 */
export type TalkEntry = {
    ts: string;                  // ISO timestamp
    direction: "in" | "out";
    peer: string;                // 对端 ooc:// URI
    content: string;
};

/**
 * append 一条 talk entry 到对应 jsonl 文件 (auto-create dir + file)。
 */
export async function appendTalkEntry(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    entry: TalkEntry,
): Promise<void> {
    await ensureTalksDir(worldRoot, sessionId, objectName);
    const f = talksFile(worldRoot, sessionId, objectName, entry.peer);
    await fs.appendFile(f, JSON.stringify(entry) + "\n");
}

/* -------------------- threads/<id>/ -------------------- */

export function threadsDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(flowObjectDir(worldRoot, sessionId, objectName), "threads");
}

export function threadDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    threadId: string,
): string {
    return path.join(threadsDir(worldRoot, sessionId, objectName), threadId);
}

export async function ensureThreadDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    threadId: string,
): Promise<string> {
    const dir = threadDir(worldRoot, sessionId, objectName, threadId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/* -------------------- todos.json / plan.md (Object 主 thread 字段) -------------------- */

export function todosFile(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(flowObjectDir(worldRoot, sessionId, objectName), "todos.json");
}

export function planFile(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(flowObjectDir(worldRoot, sessionId, objectName), "plan.md");
}

/* -------------------- generic helpers -------------------- */

/**
 * 生成简短随机 id 用于 thread / ephemeral object 命名。
 * 8 字符 hex。
 */
export function shortId(prefix?: string): string {
    const hex = Math.random().toString(16).slice(2, 10);
    return prefix ? `${prefix}_${hex}` : hex;
}
