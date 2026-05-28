/**
 * super-flow — ephemeral Object 升格为 persistent 的 fork snapshot（spec §3.8）。
 *
 * promoteEphemeral 把 flows/<sessionId>/objects/<id>/ 中的「设计文件」
 * 复制到 stones/<branch>/objects/<targetName>/，形成一个 persistent Object 的种子。
 * 同时可选地把「累积产物」写入 pools/objects/<targetName>/。
 * 原 flows/ 目录保持不动（考古链）。
 *
 * 设计文件（Design files）: self.md, readme.md, client/（如果有）
 * 运行时文件（非设计，跳过）: talks/, threads/, .flow.json, todos.json, plan.md
 * 累积产物（Pool files）: pool.json（如果有）
 */

import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Design 文件名单（从 flows/ 复制到 stones/）。 */
const DESIGN_FILES = ["self.md", "readme.md"];
/** Design 目录名单（递归复制）。 */
const DESIGN_DIRS = ["client", "server"];
/** Pool 文件名单（从 flows/ 复制到 pools/）。 */
const POOL_FILES = ["pool.json"];

/** promoteEphemeral 的输入参数。 */
export interface PromoteEphemeralOpts {
    /** OOC world 根目录（绝对路径）。 */
    worldRoot: string;
    /** 源 ephemeral Object 的 URI：必须是 ooc://flows/<sessionId>/objects/<id> 格式。 */
    sourceUri: string;
    /** 目标 branch（stones/<targetBranch>/objects/<targetName>/）。 */
    targetBranch: string;
    /** 目标 Object 名（持久化后使用的名称）。 */
    targetName: string;
    /** 是否同时把累积产物写到 pools/（默认 true，若源无 pool.json 则安静跳过）。 */
    copyPool?: boolean;
}

/** promoteEphemeral 的返回值。 */
export interface PromoteEphemeralResult {
    /** 新创建的 persistent Object 的 ooc:// URI。 */
    persistentUri: string;
    /** stones/ 目录的绝对路径。 */
    stonePath: string;
    /** pools/ 目录的绝对路径（若 copyPool=false 或无 pool 文件则为 undefined）。 */
    poolPath?: string;
    /** 哪些 design 文件实际被复制。 */
    copiedDesignFiles: string[];
    /** 是否复制了 pool 文件。 */
    poolCopied: boolean;
}

/**
 * 解析 sourceUri 中的 sessionId 与 objectId。
 * 合法格式: ooc://flows/<sessionId>/objects/<objectId>
 */
function parseSourceUri(sourceUri: string): { sessionId: string; objectId: string } {
    const prefix = "ooc://flows/";
    if (!sourceUri.startsWith(prefix)) {
        throw new Error(
            `sourceUri 必须是 ooc://flows/<sessionId>/objects/<id> 格式，got: ${sourceUri}`,
        );
    }
    const rest = sourceUri.slice(prefix.length); // "<sessionId>/objects/<objectId>"
    const objIdx = rest.indexOf("/objects/");
    if (objIdx < 0) {
        throw new Error(`sourceUri 缺少 /objects/ 段: ${sourceUri}`);
    }
    const sessionId = rest.slice(0, objIdx);
    const objectId = rest.slice(objIdx + "/objects/".length);
    if (!sessionId || !objectId) {
        throw new Error(`sourceUri 解析失败（空 sessionId 或 objectId）: ${sourceUri}`);
    }
    return { sessionId, objectId };
}

/**
 * 安全 copy 单个文件（如源不存在则静默跳过）。
 * 返回是否实际发生了 copy。
 */
async function safeCopyFile(srcFile: string, dstFile: string): Promise<boolean> {
    if (!existsSync(srcFile)) return false;
    await mkdir(join(dstFile, ".."), { recursive: true });
    const content = await readFile(srcFile);
    await writeFile(dstFile, content);
    return true;
}

/**
 * 安全 copy 目录（如源不存在则静默跳过）。
 * 返回是否实际发生了 copy。
 */
async function safeCopyDir(srcDir: string, dstDir: string): Promise<boolean> {
    if (!existsSync(srcDir)) return false;
    try {
        const s = await stat(srcDir);
        if (!s.isDirectory()) return false;
    } catch {
        return false;
    }
    await cp(srcDir, dstDir, { recursive: true });
    return true;
}

/**
 * 把 ephemeral Object fork snapshot 到 stones/ + 可选 pools/。
 *
 * @throws 当 sourceUri 格式非法或源目录不存在时抛错。
 */
export async function promoteEphemeral(
    opts: PromoteEphemeralOpts,
): Promise<PromoteEphemeralResult> {
    const { worldRoot, sourceUri, targetBranch, targetName, copyPool = true } = opts;

    const { sessionId, objectId } = parseSourceUri(sourceUri);

    // 源目录（flows/）
    const srcDir = join(worldRoot, "flows", sessionId, "objects", objectId);
    if (!existsSync(srcDir)) {
        throw new Error(`源 ephemeral 目录不存在: ${srcDir}`);
    }

    // 目标 stone 目录
    const stonePath = join(worldRoot, "stones", targetBranch, "objects", targetName);
    await mkdir(stonePath, { recursive: true });

    // 复制 design 文件
    const copiedDesignFiles: string[] = [];

    for (const fname of DESIGN_FILES) {
        const copied = await safeCopyFile(join(srcDir, fname), join(stonePath, fname));
        if (copied) copiedDesignFiles.push(fname);
    }
    for (const dname of DESIGN_DIRS) {
        const copied = await safeCopyDir(join(srcDir, dname), join(stonePath, dname));
        if (copied) copiedDesignFiles.push(`${dname}/`);
    }

    // 复制 pool 文件（可选）
    let poolPath: string | undefined;
    let poolCopied = false;

    if (copyPool) {
        const poolDest = join(worldRoot, "pools", "objects", targetName);
        for (const fname of POOL_FILES) {
            const copied = await safeCopyFile(
                join(srcDir, fname),
                join(poolDest, fname),
            );
            if (copied) {
                poolPath = poolDest;
                poolCopied = true;
            }
        }
    }

    const persistentUri = `ooc://stones/${targetBranch}/objects/${targetName}`;

    return {
        persistentUri,
        stonePath,
        poolPath,
        copiedDesignFiles,
        poolCopied,
    };
}
