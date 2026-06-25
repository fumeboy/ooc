/**
 * runtime persistence —— 把 session 对象表的对象 data 落到磁盘 / 从磁盘 hydrate 回内存。
 *
 * 设计权威：`.ooc-world-meta/.../children/persistable/self.md`。
 *
 * 核心机制：
 * - 落盘：经 `resolvePersistable(class).save(ctx, data)` 泛型派发；缺省走 `data.json`。
 * - hydrate：扫 `flows/<sid>/objects/`、每个目录读 `.flow.json` 拿 class、调 `resolvePersistable(class).load(ctx)`。
 *
 * persistence 不挂到 thread 数据上——所有 dir 派生靠 `(baseDir, sessionId, objectId)` 三元组
 * 经 `objectDir(ref)` 计算。
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ClassRegistry,
  type ObjectInsRegistry,
  getSessionRegistry,
} from "../runtime/object-registry.js";
import type { OocObjectInstance } from "../runtime/ooc-class.js";
import type { PersistableContext } from "../types/persistable.js";
import { objectDir, toJson } from "./common.js";

/**
 * 落盘一个 object 实例的业务 data。
 *
 * 优先 `class.persistable.save`；缺省直接 JSON.stringify(data) 落到 `data.json`。
 * inline 模式（class 不声明 save 但有 inline 子段）跳过——它由父对象（thread）整体落盘。
 */
export async function saveObjectData(
  baseDir: string,
  sessionId: string,
  inst: OocObjectInstance,
  registry: ClassRegistry,
): Promise<void> {
  const dir = objectDir({ baseDir, sessionId, objectId: inst.id });
  const persistable = registry.resolvePersistable(inst.class);
  // class 自定义 save 路径
  if (persistable?.save) {
    const ctx: PersistableContext = {
      baseDir,
      sessionId,
      objectId: inst.id,
      dir,
    };
    await persistable.save(ctx, inst.data);
    // 额外写 .flow.json 标记 class（hydrate 时按它派发）
    await writeFlowMeta(dir, inst.class);
    return;
  }
  // 系统默认：data.json
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "data.json"), toJson(inst.data), "utf8");
  await writeFlowMeta(dir, inst.class);
}

async function writeFlowMeta(dir: string, classId: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".flow.json"), toJson({ class: classId }), "utf8");
}

/** 读 dir 下的 .flow.json 拿 class id；缺则 undefined。 */
async function readFlowMeta(dir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(dir, ".flow.json"), "utf8");
    const j = JSON.parse(raw) as { class?: string };
    return j.class;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** 读单个对象的业务 data（经 class.persistable.load 或默认 data.json）。 */
async function loadObjectData(
  baseDir: string,
  sessionId: string,
  objectId: string,
  registry: ClassRegistry,
): Promise<OocObjectInstance | undefined> {
  const dir = objectDir({ baseDir, sessionId, objectId });
  const classId = await readFlowMeta(dir);
  if (!classId) return undefined;
  const persistable = registry.resolvePersistable(classId);
  if (persistable?.load) {
    const ctx: PersistableContext = { baseDir, sessionId, objectId, dir };
    const data = await persistable.load(ctx);
    if (data === undefined) return undefined;
    return { id: objectId, class: classId, data };
  }
  // 默认 data.json
  try {
    const raw = await readFile(join(dir, "data.json"), "utf8");
    return { id: objectId, class: classId, data: JSON.parse(raw) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/**
 * 把整个 session 的对象表落盘。
 *
 * 遍历 `getSessionRegistry(sessionId)` 的所有实例，逐一调 `saveObjectData`。
 */
export async function persistSession(baseDir: string, sessionId: string): Promise<void> {
  const reg = getSessionRegistry(sessionId);
  const tasks: Promise<void>[] = [];
  reg.iterObjects((inst) => {
    tasks.push(saveObjectData(baseDir, sessionId, inst, reg));
  });
  await Promise.all(tasks);
}

/**
 * Hydrate 一个 session 的对象表 —— 扫 `flows/<sid>/objects/` 重建 ObjectInsRegistry。
 *
 * 每个 `objects/<id>/` 目录读 `.flow.json` 拿 class、调 persistable.load 回数据。
 *
 * 同时调 `hydrateStones(baseDir, reg)` 把 stones/main/objects/ 下的长期身份对象一并加载
 * （session 启动时 stone 对象先入表，flow 对象再覆盖）。
 */
export async function hydrateSession(baseDir: string, sessionId: string): Promise<ObjectInsRegistry> {
  const reg = getSessionRegistry(sessionId);
  await hydrateStones(baseDir, reg);
  const root = join(baseDir, "flows", sessionId, "objects");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return reg; // 新 session：空表
    throw e;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const inst = await loadObjectData(baseDir, sessionId, e.name, reg);
    if (inst) reg.setObject(inst);
  }
  return reg;
}

// ───────────────────────────────────── stones (长期身份层) ─────────────────────────────────────

import { stat } from "node:fs/promises";

/**
 * 从 stones/main/objects/<id>/ 读一个 stone object 的身份（无运行时 data，主要给 self.md / readable.md）。
 *
 * 读 package.json 的 `ooc.{objectId, class}`，self.md 全文，把 data 拼成 `{ self: <selfMd> }`
 * （agent class 的 Data 形状）。
 */
async function loadStoneObject(stoneDir: string, objectId: string): Promise<{ class: string; data: unknown } | undefined> {
  let pkgRaw: string;
  try {
    pkgRaw = await readFile(join(stoneDir, "package.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  const pkg = JSON.parse(pkgRaw) as { ooc?: { kind?: string; class?: string } };
  // 只 hydrate kind=object 的 stone（class 定义不实例化）
  if (pkg.ooc?.kind !== "object") return undefined;
  const cls = pkg.ooc.class ?? "_builtin/agent";
  // 读 self.md 作为 agent.data.self
  let selfMd = "";
  try {
    selfMd = await readFile(join(stoneDir, "self.md"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return { class: cls, data: { self: selfMd } };
}

/** 扫 stones/main/objects/ 一级目录，把每个 stone object 实例化到 session 注册表。 */
export async function hydrateStones(
  baseDir: string,
  reg: ObjectInsRegistry,
): Promise<void> {
  const root = join(baseDir, "stones", "main", "objects");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    const stoneDir = join(root, e.name);
    // 检查是 dir 且包含 package.json
    try {
      const s = await stat(join(stoneDir, "package.json"));
      if (!s.isFile()) continue;
    } catch {
      continue;
    }
    const obj = await loadStoneObject(stoneDir, e.name);
    if (obj) reg.setObject({ id: e.name, class: obj.class, data: obj.data });
  }
}
