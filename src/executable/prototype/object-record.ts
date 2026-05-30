// src/executable/prototype/object-record.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSelfMeta } from "./self-meta";

/** 原型链 registry 的链节点。 */
export interface ObjectRecord {
  /** 逻辑 canonical id（如 ooc://stones/_builtin/objects/search），registry 链接 key。 */
  id: string;
  /** 规范化父节点 canonical id；null = 链终点。 */
  extends: string | null;
  /** 对象目录绝对路径（payload 物理位置；world stone 或 src/extendable/base 皆可）。 */
  dir: string;
  /** slot 存在性（内容非空才算存在；空占位/缺失 ≡ false）。 */
  has: { executable: boolean; readable: boolean; visible: boolean };
}

// 对象目录内的相对文件布局（与 persistable stone 布局对齐；这里独立列出，
// 因 ObjectRecord 现在按任意目录加载，不限 world stones）。
const SELF_FILE = "self.md";
const READABLE_FILE = "readable.md";
const EXECUTABLE_FILE = join("executable", "index.ts");
const VISIBLE_FILE = join("client", "index.tsx");

/** 内容非空判定：空字符串 / undefined / 纯空白 ≡ 缺失。 */
function nonEmpty(s: string | undefined): boolean {
  return (s ?? "").trim().length > 0;
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 从对象目录 dir 读 self.md → 解析 extends → 探测 slot 存在性，组装 ObjectRecord。
 *
 * id 由调用方提供（逻辑寻址与物理目录解耦）：world 对象用 canonicalObjectId(ref)，
 * base 原型用 builtinProtoId(name)。
 *
 * - self.md 缺失 = 该目录不是一个 Object → 抛错（fail-loud）。空 self.md 合法（默认 extends root）。
 * - slot 按"内容非空"判定（空占位/缺失 ≡ 缺失）。readable.ts 动态 readable L2/L3 不探测。
 */
export async function loadObjectRecord(dir: string, id: string): Promise<ObjectRecord> {
  const selfText = await readFileOrUndefined(join(dir, SELF_FILE));
  if (selfText === undefined) {
    throw new Error(`loadObjectRecord: self.md 不存在于 ${dir}，不是一个 Object`);
  }
  const meta = parseSelfMeta(selfText);
  const [exe, rdb, vis] = await Promise.all([
    readFileOrUndefined(join(dir, EXECUTABLE_FILE)),
    readFileOrUndefined(join(dir, READABLE_FILE)),
    readFileOrUndefined(join(dir, VISIBLE_FILE)),
  ]);
  return {
    id,
    extends: meta.extends,
    dir,
    has: { executable: nonEmpty(exe), readable: nonEmpty(rdb), visible: nonEmpty(vis) },
  };
}
