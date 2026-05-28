/**
 * ThinkThread persistence: thread.json 的写入与读取。
 *
 * 文件位置：`flows/<sessionId>/objects/<objectName>/threads/<threadId>/thread.json`
 *
 * 设计原则：
 * - writeThread 在 worker tick 完成后调用，保证 crash 后可按最近快照恢复
 * - readThread 用于 resume（启动时或 HTTP /api/flows/.../threads/:id 查询）
 * - 原子写（先写 .tmp 后 rename）防止半截文件被读取
 * - 路径函数独立导出，便于 HTTP 层直接计算
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThinkThread } from "@src/thinkable/think-thread";

/**
 * 从 objectUri 中提取 objectName（最后一个路径段）。
 *
 * 例: ooc://stones/main/objects/foo → "foo"
 *     ooc://flows/ses_abc/objects/bar → "bar"
 */
export function objectNameFromUri(uri: string): string {
    const segments = uri.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1] ?? "unknown";
}

/**
 * 计算 thread.json 文件的绝对路径。
 */
export function threadJsonPath(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    threadId: string,
): string {
    return join(worldRoot, "flows", sessionId, "objects", objectName, "threads", threadId, "thread.json");
}

/**
 * 读取并解析 thread.json；文件不存在或解析失败返回 null。
 */
export async function readThread(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    threadId: string,
): Promise<ThinkThread | null> {
    const filePath = threadJsonPath(worldRoot, sessionId, objectName, threadId);
    let raw: string;
    try {
        raw = await readFile(filePath, "utf8");
    } catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as ThinkThread;
        // 基础字段校验
        if (
            typeof parsed.id !== "string" ||
            typeof parsed.sessionId !== "string" ||
            typeof parsed.objectUri !== "string" ||
            !Array.isArray(parsed.messages)
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * 把 thread 原子写入 thread.json（先写 .tmp 后 rename）。
 *
 * 自动创建父目录。
 */
export async function writeThread(
    thread: ThinkThread,
    worldRoot: string,
): Promise<void> {
    const objectName = objectNameFromUri(thread.objectUri);
    const filePath = threadJsonPath(worldRoot, thread.sessionId, objectName, thread.id);
    const dir = join(filePath, "..");
    await mkdir(dir, { recursive: true });

    const tmpPath = filePath + ".tmp";
    const json = JSON.stringify(thread, null, 2) + "\n";

    await writeFile(tmpPath, json, "utf8");
    try {
        await rename(tmpPath, filePath);
    } catch (err) {
        // cleanup tmp on rename failure
        await rm(tmpPath, { force: true });
        throw err;
    }
}
