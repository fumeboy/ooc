/**
 * runtime persistence —— 把 session 对象表的对象 data 落到磁盘 / 从磁盘 hydrate 回内存。
 *
 * 设计权威：`.ooc-world-meta/.../children/persistable/self.md`。
 *
 * 核心机制（issue C 三层重定位）：
 * - **落盘**：`saveObjectData` 默认 scope="flow"——method 路径恒落 flow 暂存（`flows/<sid>/objects/<id>/data.json`）。
 *   reflectable 分发器后续以 scope="stone"/"pool" 重调（issue D 主体）。class 自声明 save 时
 *   runtime 传入 `ctx.scope`，旧实现可忽略此字段（兼容 = "flow" 默认）。
 * - **hydrate**：顺序 stone canonical + pool sediment + flow override（flow 覆盖一切）；
 *   merge 后入 session 对象表。完成后写 `.hydrate-snapshot.json`（字段 hash），供 issue D 增量检测用。
 * - **write-through**：method 内 mutate self.data 立即落 flow 暂存 + 同步保留 session 对象表
 *   引用（session 对象表持的就是同一份 data 引用——mutate 即可见，无需额外写回；本文件
 *   只负责持久化）。
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
import type { PersistableContext, PersistableScope } from "../types/persistable.js";
import { objectDir, toJson } from "./common.js";
import { recordHydrate } from "./hydrate-snapshot.js";

/**
 * 把 data 按 VERSIONED_FIELDS 拆成 versioned / unversioned 两部分。
 *
 * 列在 versionedFields 内的 key → versioned；其余 → unversioned。
 * 缺失键不出现在结果里（versioned 只含 data 已有的版本化字段）。
 */
export function splitByVersioned<D extends Record<string, unknown>>(
  data: D,
  versionedFields: readonly string[],
): { versioned: Partial<D>; unversioned: Partial<D> } {
  const versioned: Partial<D> = {};
  const unversioned: Partial<D> = {};
  const vset = new Set(versionedFields);
  for (const k of Object.keys(data) as Array<keyof D>) {
    if (vset.has(k as string)) {
      (versioned as Record<string, unknown>)[k as string] = data[k];
    } else {
      (unversioned as Record<string, unknown>)[k as string] = data[k];
    }
  }
  return { versioned, unversioned };
}

/**
 * 落盘一个 object 实例的业务 data —— 默认 scope="flow"（method 路径）。
 *
 * 流程：
 *   1. 整份 data 写 `flows/<sid>/objects/<id>/data.json`（flow working copy；含 versioned + unversioned 全字段）。
 *   2. 若 class 自声明 `persistable.save`，以 `ctx.scope="flow"` 调用一次；自定义 save
 *      可按 scope 分支决定写什么（如 agent.save 在 scope=flow 时额外把 self 字段写 worktree 内 self.md）。
 *   3. 写 `.flow.json` 标记 class（hydrate 时按它派发）。
 *
 * 内存可见性：method exec 拿到的 self 是 session 对象表中 instance.data 的引用，mutate 立刻
 * 在 session 对象表生效（A 区核心 4 单实例 map）；本函数只负责把内存值持久化到磁盘。
 *
 * **本 issue 不调用 scope="stone"/"pool" 路径**——reflectable 分发器（issue D）后续以这两个
 * scope 重调本函数（或自定义 save）实现 PR / pool 合入。
 */
export async function saveObjectData(
  baseDir: string,
  sessionId: string,
  inst: OocObjectInstance,
  registry: ClassRegistry,
  scope: PersistableScope = "flow",
): Promise<void> {
  const dir = objectDir({ baseDir, sessionId, objectId: inst.id });
  await mkdir(dir, { recursive: true });

  // 1. flow working copy：单 data.json 持整份 data（含 versioned + unversioned）。
  //    本 issue 仅落 scope=flow；其他 scope 留给 issue D 分发器。
  if (scope === "flow") {
    await writeFile(join(dir, "data.json"), toJson(inst.data), "utf8");
    await writeFlowMeta(dir, inst.class);
  }

  // 2. 自定义 save —— runtime 注入 scope；自定义实现可按 scope 决定写什么。
  const persistable = registry.resolvePersistable(inst.class);
  if (persistable?.save) {
    const ctx: PersistableContext = {
      baseDir,
      sessionId,
      objectId: inst.id,
      dir,
      scope,
    };
    await persistable.save(ctx, inst.data);
    // class 自声明 save 时仍写 .flow.json，hydrate 派发要用。
    if (scope === "flow") await writeFlowMeta(dir, inst.class);
  }
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
    const ctx: PersistableContext = { baseDir, sessionId, objectId, dir, scope: "flow" };
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
 * 遍历 `getSessionRegistry(sessionId)` 的所有实例，逐一调 `saveObjectData`（默认 scope="flow"）。
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
 * Hydrate 一个 session 的对象表 —— 顺序 stone canonical + pool sediment + flow override。
 *
 * 1. 扫 `stones/main/objects/` 把每个 stone object 入表（canonical 版本化字段）。
 * 2. （pool sediment 当前仅有 knowledge sediment；普通 object data 不走 pool——故无单独
 *    pool merge 步骤；knowledge sediment 经各 class 自己的 readable / activator 加载。）
 * 3. 扫 `flows/<sid>/objects/` 读 `.flow.json` + `data.json`，flow 值覆盖 stone canonical。
 * 4. 完成后写 `.hydrate-snapshot.json`（字段 hash），供 issue D 增量检测。
 */
export async function hydrateSession(baseDir: string, sessionId: string): Promise<ObjectInsRegistry> {
  const reg = getSessionRegistry(sessionId);
  await hydrateStones(baseDir, reg);
  const root = join(baseDir, "flows", sessionId, "objects");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // 新 session：仅 stone 数据；仍记一份 snapshot（基线 = 当前 stone 视图）。
      await snapshotSession(baseDir, sessionId, reg);
      return reg;
    }
    throw e;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const inst = await loadObjectData(baseDir, sessionId, e.name, reg);
    if (inst) reg.setObject(inst); // flow override 覆盖前面 hydrateStones 入的 canonical
  }
  await snapshotSession(baseDir, sessionId, reg);
  return reg;
}

/** 给 session 对象表的每个对象记录 hydrate-snapshot（字段级 hash 基线）。 */
async function snapshotSession(
  baseDir: string,
  sessionId: string,
  reg: ObjectInsRegistry,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  reg.iterObjects((inst) => {
    const data = inst.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") return;
    tasks.push(recordHydrate(baseDir, sessionId, inst.id, data));
  });
  await Promise.all(tasks);
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
