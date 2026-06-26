/**
 * hydrate snapshot —— 记录某 session hydrate 完成时每个对象每个字段的 content hash + stone HEAD sha。
 *
 * issue C 倒灌（issue D 依赖）：scan_changes 增量检测的基础。reflectable 分发器在 session
 * 结束（或显式 `talk(super)`）时对照 snapshot 找出哪些字段「自 hydrate 以来变过」，
 * 决定走 stone PR 还是 pool 合入。
 *
 * 运行时物——存 `flows/<sid>/.hydrate-snapshot.json`，**不进 git**（main 根 .gitignore 黑名单）。
 *
 * 当前 issue C 仅生成 snapshot，不消费（消费在 issue D）。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 单个对象在 hydrate 时刻的快照（字段级 hash + stone HEAD sha）。 */
export interface ObjectHydrateSnapshot {
  /** 字段 → content hash（sha256，hex）。值序列化为 stable JSON 后 hash。 */
  fields: Record<string, string>;
  /** hydrate 时刻 stones/main 分支 HEAD commit sha（可选；无 git/无 commit 时为空字符串）。 */
  stoneHead?: string;
  /** 写入时间戳（debug / 兼容性查验）。 */
  recordedAt: number;
}

/** 整个 flow 一份 snapshot（objectId → ObjectHydrateSnapshot）。 */
export type FlowHydrateSnapshot = Record<string, ObjectHydrateSnapshot>;

function snapshotPath(baseDir: string, sessionId: string): string {
  return join(baseDir, "flows", sessionId, ".hydrate-snapshot.json");
}

/** stable stringify：按 key 字典序，保证同语义对象 hash 稳定。 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map(stableStringify).join(",") + "]";
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
    "}"
  );
}

/** 单个字段值 → sha256 hex。 */
export function hashField(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/**
 * 记录一个对象 hydrate 时的字段 hash —— 增量合并到 `.hydrate-snapshot.json`。
 *
 * 多次调用同 objectId 覆盖该对象 entry；其它 object entry 保留。
 */
export async function recordHydrate(
  baseDir: string,
  sessionId: string,
  objectId: string,
  fields: Record<string, unknown>,
  opts?: { stoneHead?: string },
): Promise<void> {
  const snap = await readSnapshot(baseDir, sessionId);
  const hashed: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    hashed[k] = hashField(v);
  }
  snap[objectId] = {
    fields: hashed,
    stoneHead: opts?.stoneHead,
    recordedAt: Date.now(),
  };
  await writeSnapshot(baseDir, sessionId, snap);
}

/** 读 snapshot；缺则空对象。 */
export async function readSnapshot(
  baseDir: string,
  sessionId: string,
): Promise<FlowHydrateSnapshot> {
  try {
    const raw = await readFile(snapshotPath(baseDir, sessionId), "utf8");
    return JSON.parse(raw) as FlowHydrateSnapshot;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

async function writeSnapshot(
  baseDir: string,
  sessionId: string,
  snap: FlowHydrateSnapshot,
): Promise<void> {
  const path = snapshotPath(baseDir, sessionId);
  await mkdir(join(baseDir, "flows", sessionId), { recursive: true });
  await writeFile(path, JSON.stringify(snap, null, 2), "utf8");
}
