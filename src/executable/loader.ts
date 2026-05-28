/**
 * Object loader: 扫描三层源（stone builtin/branch + pool per-Object + flow current）建 ObjectRecord 列表。
 *
 * 详见 spec §4.1。
 */

import { promises as fs } from "node:fs";
import { join, relative } from "node:path";
import * as yaml from "js-yaml";
import {
    type ObjectRecord,
    type SelfFrontmatter,
} from "../persistable/object-record";
import { relativePathToURI } from "../persistable/uri";

/**
 * Loader 输入：world root 与可选的 active branch / sessionId。
 */
export type LoaderConfig = {
    /** world 根目录绝对路径（包含 stones/ pools/ flows/） */
    worldRoot: string;
    /** stone branch persistent 扫描根，如 "main"；省略不扫 branch persistent */
    branch?: string;
    /** 当前活跃 session id；省略不扫 flow */
    sessionId?: string;
};

/**
 * 扫描所有三层源并返回 ObjectRecord 列表。
 *
 * 顺序: builtin → branch persistent → flow ephemeral。
 * 由调用方负责将结果灌进 registry（不在 loader 中维持状态）。
 */
export async function loadObjects(config: LoaderConfig): Promise<ObjectRecord[]> {
    const records: ObjectRecord[] = [];

    // 1. builtin: stones/_builtin/objects/<proto>/
    const builtinDir = join(config.worldRoot, "stones", "_builtin", "objects");
    if (await directoryExists(builtinDir)) {
        const names = await listSubdirs(builtinDir);
        for (const name of names) {
            const stonePath = join(builtinDir, name);
            const self = await readSelfMd(stonePath);
            records.push({
                uri: `ooc://stones/_builtin/objects/${name}`,
                paths: { stone: stonePath },
                kind: "builtin",
                self,
            });
        }
    }

    // 2. branch persistent: stones/<branch>/objects/<name>/[children/<sub>/]*
    if (config.branch) {
        const branchObjectsDir = join(
            config.worldRoot,
            "stones",
            config.branch,
            "objects",
        );
        if (await directoryExists(branchObjectsDir)) {
            for await (const stonePath of walkObjectTree(branchObjectsDir)) {
                const relFromWorld = relative(config.worldRoot, stonePath);
                const self = await readSelfMd(stonePath);
                const uri = relativePathToURI(relFromWorld);
                const poolPath = poolPathFor(config.worldRoot, stonePath, branchObjectsDir);
                records.push({
                    uri,
                    paths: { stone: stonePath, pool: poolPath },
                    kind: "persistent",
                    self,
                });
            }
        }
    }

    // 3. flow current session: flows/<sessionId>/objects/<id>/
    if (config.sessionId) {
        const flowObjectsDir = join(
            config.worldRoot,
            "flows",
            config.sessionId,
            "objects",
        );
        if (await directoryExists(flowObjectsDir)) {
            const ids = await listSubdirs(flowObjectsDir);
            for (const id of ids) {
                const flowPath = join(flowObjectsDir, id);
                const self = await readSelfMd(flowPath);
                records.push({
                    uri: `ooc://flows/${config.sessionId}/objects/${id}`,
                    paths: { flow: flowPath },
                    kind: "ephemeral",
                    self,
                });
            }
        }
    }

    return records;
}

/* ---------------- internal helpers ---------------- */

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

/**
 * 在 branch persistent 树中递归遍历 Object 目录（顶层 + children/<sub>/+），
 * 仅 yield 含 self.md 的目录。
 */
async function* walkObjectTree(rootDir: string): AsyncGenerator<string> {
    const queue: string[] = await listSubdirs(rootDir).then((names) =>
        names.map((n) => join(rootDir, n)),
    );
    while (queue.length > 0) {
        const dir = queue.shift()!;
        const selfPath = join(dir, "self.md");
        if (await fileExists(selfPath)) {
            yield dir;
        }
        const childrenDir = join(dir, "children");
        if (await directoryExists(childrenDir)) {
            const subs = await listSubdirs(childrenDir);
            for (const sub of subs) {
                queue.push(join(childrenDir, sub));
            }
        }
    }
}

async function fileExists(p: string): Promise<boolean> {
    try {
        const stat = await fs.stat(p);
        return stat.isFile();
    } catch {
        return false;
    }
}

async function readSelfMd(objectDir: string): Promise<SelfFrontmatter> {
    const selfPath = join(objectDir, "self.md");
    let content: string;
    try {
        content = await fs.readFile(selfPath, "utf8");
    } catch {
        // 无 self.md 视为空 frontmatter（builtin / 占位目录场景）
        return {};
    }
    const fm = parseFrontmatter(content);
    return fm;
}

/**
 * 解析 markdown 文件顶部 --- yaml --- 块。无 frontmatter 时返回 {}。
 */
function parseFrontmatter(content: string): SelfFrontmatter {
    if (!content.startsWith("---")) {
        return {};
    }
    const end = content.indexOf("\n---", 3);
    if (end === -1) {
        return {};
    }
    const yamlBlock = content.slice(3, end).replace(/^\n/, "");
    const parsed = yaml.load(yamlBlock);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as SelfFrontmatter;
    }
    return {};
}

/**
 * 从 stone 路径推导 pool 路径。
 *
 * 例：
 * - stones/main/objects/foo → pools/objects/foo
 * - stones/main/objects/foo/children/bar → pools/objects/foo/children/bar （扁平复制）
 *
 * pool 不分 branch；branch 段在路径上被剥离。
 */
function poolPathFor(worldRoot: string, stonePath: string, branchObjectsDir: string): string {
    const relFromBranchObjects = relative(branchObjectsDir, stonePath);
    return join(worldRoot, "pools", "objects", relFromBranchObjects);
}
