/**
 * flow-scan —— 扫描 flow 暂存内的字段级 / class 源码改动，为 reflect method 链路
 * `scan_changes` 提供清单（issue D 落地裁决 5）。
 *
 * 三组输出：
 * 1. versionedChanges  — 版本化字段差异（vs stone main canonical）。
 * 2. unversionedChanges — 非版本化字段差异（vs stone main canonical）。
 * 3. classEdits         — flow worktree 内 class 源码 vs stone main 的 git diff。
 *
 * 本 issue 简化版（**TODO: verified 后改读 class.versioned_fields，由 issue C 提供**）：
 * - 字段版本化判定**硬编码**：agent → ["self"]；其他类型 → 空数组（即视为 unversioned）。
 * - 不维护 hydrate-snapshot；直接 flow data.json vs stone canonical 比对。
 * - 不做 conflict 检测（vs stone HEAD）；issue C 落地后再补。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  objectDir,
  nestedObjectPath,
  STONES_MAIN_BRANCH,
  STONE_OBJECTS_SUBDIR,
  STONES_BARE_REPO_DIR,
} from "./common.js";
import { gitDiffNames, gitDiffPatch } from "./stone-git.js";
import { sessionWorktreePath, sessionStoneBranch } from "./stone-worktree.js";

/** 单个字段差异。 */
export interface FieldDiff {
  field: string;
  /** stone canonical 值（JSON 字符串）；缺省 = 未在 stone 设过该字段。 */
  oldValue: string | undefined;
  /** flow 当前值（JSON 字符串）。 */
  newValue: string;
}

/** 单个 class 源码编辑（vs stone main）。 */
export interface ClassEditEntry {
  path: string;
  /** git status 字符（A/M/D 等）。 */
  status: "added" | "modified" | "deleted" | "other";
}

export interface ScanFlowChangesResult {
  versionedDirty: FieldDiff[];
  unversionedDirty: FieldDiff[];
}

/**
 * **本 issue 占位**：根据 classId 返回该 class 哪些字段是 versioned。
 *
 * TODO(issue-C-VERSIONED_FIELDS)：issue C verified 后应改读 class.versioned_fields，
 * 由 OocClass 声明。本 issue D worktree 基于 main 不带 issue C，硬编码：
 *   - `_builtin/agent` 及其继承类（supervisor / user / 自定义 agent） → ["self"]
 *   - 其他 class → 空（即所有字段视为 unversioned）
 */
function getVersionedFields(classId: string): string[] {
  // agent 与其派生 class（包括 _builtin/agent/supervisor、_builtin/agent/user 等）
  // 都把 `self` 字段视为 versioned。
  if (classId === "_builtin/agent") return ["self"];
  if (classId.startsWith("_builtin/agent/")) {
    // 排除 thread / pr 等子 class（它们不是 agent，不持有 self）。
    if (classId === "_builtin/agent/thread") return [];
    if (classId === "_builtin/agent/pr") return [];
    if (classId === "_builtin/agent/skill_index") return [];
    if (classId === "_builtin/agent/method_exec_form") return [];
    if (classId === "_builtin/agent/plan") return [];
    if (classId === "_builtin/agent/todo") return [];
    return ["self"];
  }
  return [];
}

/** 读 stone canonical data.json；不存在 / 解析失败返回 {}. */
async function readStoneCanonicalData(
  baseDir: string,
  objectId: string,
): Promise<Record<string, unknown>> {
  const segs = nestedObjectPath(objectId);
  const path = join(baseDir, "stones", STONES_MAIN_BRANCH, STONE_OBJECTS_SUBDIR, ...segs, "data.json");
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 读 flow data.json；不存在 / 解析失败返回 {}. */
async function readFlowData(
  baseDir: string,
  sessionId: string,
  objectId: string,
): Promise<Record<string, unknown>> {
  const dir = objectDir({ baseDir, sessionId, objectId });
  try {
    const raw = await readFile(join(dir, "data.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 扫描某个对象在某 session flow 内的字段级 dirty。
 *
 * 用法：scan_changes 内对每个对象（含调用 agent）依次扫描，聚合三类清单。
 */
export async function scanFlowChanges(
  baseDir: string,
  sessionId: string,
  objectId: string,
  classId: string,
): Promise<ScanFlowChangesResult> {
  const versionedFields = new Set(getVersionedFields(classId));
  const flowData = await readFlowData(baseDir, sessionId, objectId);
  const stoneData = await readStoneCanonicalData(baseDir, objectId);

  const versionedDirty: FieldDiff[] = [];
  const unversionedDirty: FieldDiff[] = [];

  // 以 flow 当前所有字段为基准；增量未含 stone 已删字段（issue C 后续考虑）。
  for (const field of Object.keys(flowData)) {
    const flowVal = flowData[field];
    const stoneVal = stoneData[field];
    const flowJson = JSON.stringify(flowVal);
    const stoneJson = stoneVal === undefined ? undefined : JSON.stringify(stoneVal);
    if (flowJson === stoneJson) continue;
    const diff: FieldDiff = {
      field,
      oldValue: stoneJson,
      newValue: flowJson,
    };
    if (versionedFields.has(field)) {
      versionedDirty.push(diff);
    } else {
      unversionedDirty.push(diff);
    }
  }

  return { versionedDirty, unversionedDirty };
}

/**
 * 扫 worktree class 源码 vs stone main 的 git diff。
 *
 * **本 issue 简化版**：用 `git diff --name-status main session-<sid>` 列出 worktree 内
 * 相对 main 的所有变更路径。session-<sid> 分支由 ensureSessionWorktree 已建立。
 *
 * 返回的 path 是相对 stones 仓库根的相对路径（如 `objects/foo/executable/index.ts`）。
 */
export async function scanWorktreeClassEdits(
  baseDir: string,
  sessionId: string,
): Promise<ClassEditEntry[]> {
  const repo = join(baseDir, "stones", STONES_MAIN_BRANCH);
  const featBranch = sessionStoneBranch(sessionId);

  // 用 --name-status 拿带状态的 diff（暂时复用 gitDiffNames 拿 paths;status 暂统一标 modified）。
  // TODO 后续可以扩 stone-git 加 gitDiffNameStatus 拿 A/M/D 三态。
  const names = gitDiffNames(repo, STONES_MAIN_BRANCH, featBranch);
  if (!names.ok) {
    // 分支不存在 / 仓库无 worktree → 空清单（非 error）。
    return [];
  }
  return names.value.map((path) => ({
    path,
    status: "modified" as const,
  }));
}
