/**
 * src/extendable/base — OOC-4 builtin 原型的源码实现（框架提供，非 world 生成）。
 *
 * 8 个原型（root + program/search/file/knowledge/command_exec/skill_index/custom）各是本目录下
 * 一个对象目录（<proto>/self.md + 可选 readable.md/executable/visible），committed 源码，与 world
 * 运行时数据分离。逻辑寻址仍是 ooc://stones/_builtin/objects/<proto>（地址 ⟂ 物理存储），
 * 由 self.md frontmatter extends 串成原型链。
 *
 * 与 lark/ 同级：lark 吃外部 SaaS；base 提供 OOC 自身原型库。被动模块（非 side-effect 注册），
 * 由消费方（L4 接活 resolve）直接 import loadBuiltinRegistry。
 */
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import {
  builtinProtoId,
  loadObjectRecord,
  buildObjectRegistry,
  type ObjectRegistry,
  type ObjectRecord,
} from "../../executable/prototype";

/** base 原型目录绝对路径（= 本模块所在目录）。项目直接 bun src/ 跑，import.meta.dir 可靠。 */
export const BASE_PROTOTYPES_DIR = import.meta.dir;

async function hasSelfMd(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, "self.md"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * 扫描 src/extendable/base/ 下全部含 self.md 的原型目录，loadObjectRecord 每个
 * （id = builtinProtoId(<dirname>)，逻辑寻址保持 ooc://stones/_builtin/objects/<proto>），
 * build 成 L2 registry（含拓扑校验）。
 */
export async function loadBuiltinRegistry(): Promise<ObjectRegistry> {
  const entries = (await readdir(BASE_PROTOTYPES_DIR, { withFileTypes: true })) as Dirent[];
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const records: ObjectRecord[] = [];
  for (const d of dirs) {
    const dir = join(BASE_PROTOTYPES_DIR, d.name);
    if (!(await hasSelfMd(dir))) continue; // 跳过 __tests__ 等非 Object 目录
    records.push(await loadObjectRecord(dir, builtinProtoId(d.name)));
  }
  return buildObjectRegistry(records);
}
