/**
 * thread —— super 投影专属 4 个 object methods（issue D 落地裁决 1；issue E：reflect_request → super）。
 *
 * 仅在 super flow self-view（thread.sessionId === "super"）的 **super** 投影内 surface。
 * 所有 method **fail-loud if ctx.sessionId !== "super"**——业务 session 偷渡入口由
 * `resolveStoneIdentityRef` 守卫挡掉，本层是 method 级双闸门（issue D 落地裁决 7）。
 *
 * 4 method 一步到位：
 *   1. scan_changes()                       — 扫 caller 的 flow 暂存，列三组清单
 *   2. create_pr_for_versioned(fields, title) — versioned 字段 → feat-branch PR
 *   3. sediment_unversioned(fields)         — unversioned 字段 → 直写 pool
 *   4. create_pr_for_class_edits(paths,title) — class 源码改动 → feat-branch PR
 *
 * 当前实施版（issue C 未合主干）简化点：
 *   - versioned 字段判定经 `ClassRegistry.resolveVersionedFields(classId)` 解析（issue F 落地后）；
 *   - reviewer thread 投递留 followup（仅 createPrIssue 落账，不实例化 pr window 进 reviewer 的
 *     thread context）；
 *   - 缺省 fields = 全部 dirty 字段；缺省 paths = 全部 class edits。
 */

import type { ExecutableContext, ObjectMethod } from "@ooc/core/types/index.js";
import type { SelfProxy } from "@ooc/core/types";
import { isSuperSessionId } from "@ooc/core/types/constants.js";
import {
  scanFlowChanges,
  scanWorktreeClassEdits,
  _promoteFlowUnversionedToPool,
  createFeatBranchPr,
  type FieldDiff,
  type ClassEditEntry,
} from "@ooc/core/persistable/index.js";
import { iterateSessionObjectTable, getSessionRegistry } from "@ooc/core/runtime/object-registry.js";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, nestedObjectPath } from "@ooc/core/persistable/common.js";
import type { ThreadContext } from "../types.js";

/** 双闸门检查：method 仅允许在 super session 内调用。 */
function requireSuperSession(ctx: ExecutableContext, methodName: string): void {
  if (!isSuperSessionId(ctx.sessionId)) {
    throw new Error(
      `[thread.${methodName}] forbidden in non-super session (sessionId=${ctx.sessionId}); ` +
        `this method only runs inside super flow (via talk(target="super")).`,
    );
  }
}

/**
 * 找 caller object（发起 super flow 的人）：本 thread 的 calleeObjectId 即 caller self。
 * （super flow 内 thread 的 calleeObjectId = caller 自己——见 talk method super alias 路径。）
 */
function getCallerObjectId(self: ThreadContext): string {
  return self.calleeObjectId;
}

/**
 * 找 caller object 所属业务 sessionId 的 hint。
 *
 * issue G：从 super thread 自身 data.callerSessionId 直读（由 talk(target="super") 创建时落盘）。
 * 老 super thread.json 在升级前无此字段 → 返 undefined，三处扫表逻辑退化为扫所有业务 flow 并
 * 在命中第一个 dirty session 后调 `selfHealCallerSessionId` 写回 self.data.callerSessionId。
 */
function findCallerSessionId(self: SelfProxy<ThreadContext>): string | undefined {
  return self.data.callerSessionId;
}

/** 列出业务 session（除 super）。reflect 三处共享。 */
async function listBusinessSessions(worldDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    const entries = await readdir(join(worldDir, "flows"));
    return entries.filter((s) => s !== "super");
  } catch {
    return [];
  }
}

/**
 * 自愈写回 callerSessionId（issue G）：fallback 扫表命中第一个 dirty session 后，把 sid 写回
 * self.data.callerSessionId 并 reportDataEdit；下次 reflect 直读 hint，免扫表。
 *
 * 仅用于旧 super thread.json（在 issue G 升级前创建、无 callerSessionId 字段）的一次性升级；
 * 新 super thread 由 talk(target="super") 创建时即落盘 callerSessionId，不走此路径。
 */
async function selfHealCallerSessionId(
  ctx: ExecutableContext,
  self: SelfProxy<ThreadContext>,
  sid: string,
): Promise<void> {
  self.data.callerSessionId = sid;
  await ctx.reportDataEdit();
}

/**
 * scan_changes —— 扫 caller 的 flow 暂存改动 + worktree class 源码改动。
 *
 * 输出三组清单 string，由 method 结果 message 渲入 super thread 的 transcript，供 caller
 * agent 决定走哪条分发通道。
 *
 * 实施：issue G 后 findCallerSessionId 直读 self.data.callerSessionId（super thread.construct 显式
 * 写入）；命中即只扫该 session 一处；callerSessionId 缺失（旧 super thread 升级前）退化扫所有业务
 * flow + 命中后自愈写回（selfHealCallerSessionId）。class edits 扫该 session 的 worktree diff。
 */
const scanChangesMethod: ObjectMethod<ThreadContext> = {
  name: "scan_changes",
  description:
    "Scan caller's flow staging (versioned + unversioned fields) + worktree class-source edits. Returns three lists.",
  schema: {},
  permission: () => "allow",
  exec: async (ctx, self) => {
    requireSuperSession(ctx, "scan_changes");
    const callerObjectId = getCallerObjectId(self.data);
    const hint = findCallerSessionId(self);

    // hint 存在 → 只扫该 session；缺失 → 退化扫所有业务 flow + 命中后自愈写回
    const sessions = hint ? [hint] : await listBusinessSessions(ctx.worldDir);

    const allVersionedDirty: { sessionId: string; field: string; oldValue?: string; newValue: string }[] = [];
    const allUnversionedDirty: { sessionId: string; field: string; oldValue?: string; newValue: string }[] = [];
    const allClassEdits: { sessionId: string; path: string; status: string }[] = [];
    let firstHitSid: string | undefined; // 用于自愈

    for (const sid of sessions) {
      // 读 .flow.json 拿 caller 的 class
      const flowDir = objectDir({ baseDir: ctx.worldDir, sessionId: sid, objectId: callerObjectId });
      let classId: string | undefined;
      try {
        const flowMetaRaw = await readFile(join(flowDir, ".flow.json"), "utf8");
        classId = (JSON.parse(flowMetaRaw) as { class?: string }).class;
      } catch {
        // 该 session 内无 caller object — 跳过
        continue;
      }
      if (!classId) continue;

      const registry = getSessionRegistry(sid);
      const versionedFields = registry.resolveVersionedFields(classId);
      const result = await scanFlowChanges(ctx.worldDir, sid, callerObjectId, versionedFields);
      for (const d of result.versionedDirty) {
        allVersionedDirty.push({ sessionId: sid, ...d });
      }
      for (const d of result.unversionedDirty) {
        allUnversionedDirty.push({ sessionId: sid, ...d });
      }
      const edits = await scanWorktreeClassEdits(ctx.worldDir, sid);
      for (const e of edits) {
        allClassEdits.push({ sessionId: sid, path: e.path, status: e.status });
      }
      // 命中（任一桶非空）→ 记录用于自愈（仅 hint 缺失分支生效）
      if (
        !firstHitSid &&
        (result.versionedDirty.length > 0 || result.unversionedDirty.length > 0 || edits.length > 0)
      ) {
        firstHitSid = sid;
      }
    }

    // 自愈：hint 缺失 + 扫到第一个有变化的 session → 写回 callerSessionId
    if (!hint && firstHitSid) {
      await selfHealCallerSessionId(ctx, self, firstHitSid);
    }

    const editsByStatus = { A: 0, M: 0, D: 0 } as Record<"A" | "M" | "D", number>;
    for (const e of allClassEdits) {
      if (e.status === "A" || e.status === "M" || e.status === "D") {
        editsByStatus[e.status] += 1;
      }
    }
    const summary = [
      `[scan_changes] caller=${callerObjectId}`,
      `versioned_dirty (${allVersionedDirty.length}):`,
      ...allVersionedDirty.map(
        (d) => `  - [${d.sessionId}] ${d.field}: ${d.oldValue ?? "<unset>"} → ${d.newValue}`,
      ),
      `unversioned_dirty (${allUnversionedDirty.length}):`,
      ...allUnversionedDirty.map(
        (d) => `  - [${d.sessionId}] ${d.field}: ${d.oldValue ?? "<unset>"} → ${d.newValue}`,
      ),
      `class_edits (${allClassEdits.length}; added=${editsByStatus.A}, modified=${editsByStatus.M}, deleted=${editsByStatus.D}):`,
      ...allClassEdits.map((e) => `  - [${e.sessionId}] ${e.status} ${e.path}`),
    ].join("\n");

    return {
      message: summary,
      data: {
        versioned_dirty: allVersionedDirty,
        unversioned_dirty: allUnversionedDirty,
        class_edits: allClassEdits,
      },
    };
  },
};

/**
 * create_pr_for_versioned —— 对指定 versioned 字段起 feat-branch PR。
 *
 * 字段未指定 → 全部 versioned dirty 字段。
 * 当前简化：仅支持 agent.self 字段（硬编码），把 newValue 写入 feat worktree 的 self.md。
 */
const createPrForVersionedMethod: ObjectMethod<ThreadContext> = {
  name: "create_pr_for_versioned",
  description:
    "Create a feat-branch PR for the given versioned fields (defaults to all dirty versioned fields). Returns prId.",
  schema: {
    fields: {
      type: "array",
      required: false,
      description: "字段名列表；缺省 = 全部 dirty versioned 字段",
    },
    title: {
      type: "string",
      required: true,
      description: "PR title / commit message",
    },
  },
  permission: () => "allow",
  exec: async (ctx, self, args) => {
    requireSuperSession(ctx, "create_pr_for_versioned");
    const title = typeof args.title === "string" ? args.title : "";
    if (!title.trim()) return { err: "[create_pr_for_versioned] title required" };
    const callerObjectId = getCallerObjectId(self.data);
    const requestedFields = Array.isArray(args.fields) ? (args.fields as string[]) : undefined;
    const hint = findCallerSessionId(self);

    const sessions = hint ? [hint] : await listBusinessSessions(ctx.worldDir);

    // 找第一个含 dirty versioned 字段的 session（含 caller object）
    let dirty: FieldDiff[] = [];
    let foundSid: string | undefined;
    for (const sid of sessions) {
      const flowDir = objectDir({ baseDir: ctx.worldDir, sessionId: sid, objectId: callerObjectId });
      let classId: string | undefined;
      try {
        const flowMetaRaw = await readFile(join(flowDir, ".flow.json"), "utf8");
        classId = (JSON.parse(flowMetaRaw) as { class?: string }).class;
      } catch {
        continue;
      }
      if (!classId) continue;
      const registry = getSessionRegistry(sid);
      const versionedFields = registry.resolveVersionedFields(classId);
      const r = await scanFlowChanges(ctx.worldDir, sid, callerObjectId, versionedFields);
      if (r.versionedDirty.length > 0) {
        dirty = r.versionedDirty;
        foundSid = sid;
        break;
      }
    }
    if (dirty.length === 0) {
      return { err: "[create_pr_for_versioned] no versioned dirty fields found" };
    }
    // 自愈：hint 缺失 + 命中 → 写回（hint 存在分支无需自愈）
    if (!hint && foundSid) {
      await selfHealCallerSessionId(ctx, self, foundSid);
    }
    const toSend = requestedFields
      ? dirty.filter((d) => requestedFields.includes(d.field))
      : dirty;
    if (toSend.length === 0) {
      return { err: "[create_pr_for_versioned] requested fields are not dirty" };
    }

    // 起 PR：本简化版只支持 self 字段，写入 feat worktree 的 self.md
    const result = await createFeatBranchPr({
      baseDir: ctx.worldDir,
      intent: title,
      authorObjectId: callerObjectId,
      authorThreadId: self.data.id,
      writeFiles: async ({ worktreePath }) => {
        const segs = nestedObjectPath(callerObjectId);
        const objectDirInWt = join(worktreePath, "objects", ...segs);
        const dataVersionedPath = join(objectDirInWt, "data.versioned.json");
        let dataVersioned: Record<string, unknown> | undefined;
        for (const d of toSend) {
          if (d.field === "self") {
            // newValue 是 JSON-string-encoded（scanFlowChanges JSON.stringify 过）。解 1 层。
            let selfText: string;
            try {
              selfText = JSON.parse(d.newValue) as string;
            } catch {
              selfText = d.newValue;
            }
            const dest = join(objectDirInWt, "self.md");
            await mkdir(dirname(dest), { recursive: true });
            const { writeFile: writeF } = await import("node:fs/promises");
            await writeF(dest, selfText, "utf8");
            continue;
          }
          // 非 self versioned 字段 → data.versioned.json (issue C 收尾)。
          // 多字段 merge：lazy 读现存 → 累积 → 在循环外一次写回。
          if (dataVersioned === undefined) {
            try {
              const raw = await readFile(dataVersionedPath, "utf8");
              dataVersioned = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              dataVersioned = {};
            }
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(d.newValue);
          } catch {
            parsed = d.newValue;
          }
          dataVersioned[d.field] = parsed;
        }
        if (dataVersioned !== undefined) {
          await mkdir(objectDirInWt, { recursive: true });
          const { writeFile: writeF } = await import("node:fs/promises");
          await writeF(dataVersionedPath, JSON.stringify(dataVersioned, null, 2), "utf8");
        }
      },
    });

    if (!result.ok) {
      return { err: `[create_pr_for_versioned] ${result.code}: ${result.message}` };
    }
    return {
      message:
        `[create_pr_for_versioned] PR opened\n` +
        `  prId: ${result.prId}\n` +
        `  branch: ${result.featBranch}\n` +
        `  reviewers: ${result.reviewers.join(", ")}\n` +
        `  paths: ${result.paths.join(", ")}`,
      data: {
        prId: result.prId,
        featBranch: result.featBranch,
        reviewers: result.reviewers,
      },
    };
  },
};

/**
 * sediment_unversioned —— 对指定 unversioned 字段直写 pool。
 * fields 缺省 → 全部 dirty unversioned 字段。
 */
const sedimentUnversionedMethod: ObjectMethod<ThreadContext> = {
  name: "sediment_unversioned",
  description:
    "Promote unversioned dirty fields from flow staging directly to pool (no PR, immediate effect).",
  schema: {
    fields: {
      type: "array",
      required: false,
      description: "字段名列表；缺省 = 全部 dirty unversioned 字段",
    },
  },
  permission: () => "allow",
  exec: async (ctx, self, args) => {
    requireSuperSession(ctx, "sediment_unversioned");
    const callerObjectId = getCallerObjectId(self.data);
    const requestedFields = Array.isArray(args.fields) ? (args.fields as string[]) : undefined;
    const hint = findCallerSessionId(self);

    const sessions = hint ? [hint] : await listBusinessSessions(ctx.worldDir);

    const allDirty: FieldDiff[] = [];
    let firstHitSid: string | undefined;
    for (const sid of sessions) {
      const flowDir = objectDir({ baseDir: ctx.worldDir, sessionId: sid, objectId: callerObjectId });
      let classId: string | undefined;
      try {
        const flowMetaRaw = await readFile(join(flowDir, ".flow.json"), "utf8");
        classId = (JSON.parse(flowMetaRaw) as { class?: string }).class;
      } catch {
        continue;
      }
      if (!classId) continue;
      const registry = getSessionRegistry(sid);
      const versionedFields = registry.resolveVersionedFields(classId);
      const r = await scanFlowChanges(ctx.worldDir, sid, callerObjectId, versionedFields);
      if (!firstHitSid && r.unversionedDirty.length > 0) {
        firstHitSid = sid;
      }
      allDirty.push(...r.unversionedDirty);
    }

    if (!hint && firstHitSid) {
      await selfHealCallerSessionId(ctx, self, firstHitSid);
    }

    const toSend = requestedFields
      ? allDirty.filter((d) => requestedFields.includes(d.field))
      : allDirty;
    if (toSend.length === 0) {
      return { err: "[sediment_unversioned] no unversioned dirty fields to promote" };
    }

    const payload: Record<string, unknown> = {};
    for (const d of toSend) {
      try {
        payload[d.field] = JSON.parse(d.newValue);
      } catch {
        payload[d.field] = d.newValue;
      }
    }
    await _promoteFlowUnversionedToPool(ctx.worldDir, callerObjectId, payload);

    return {
      message:
        `[sediment_unversioned] promoted ${toSend.length} field(s) to pool:\n` +
        toSend.map((d) => `  - ${d.field}`).join("\n"),
      data: { promoted: toSend.map((d) => d.field) },
    };
  },
};

/**
 * create_pr_for_class_edits —— 对指定 class 源码改动起 feat-branch PR。
 *
 * paths 缺省 → 全部 class edit paths。
 *
 * 实施：从 caller 的 session worktree（`flows/<sid>/objects/...`）copy 改动文件到 feat
 * worktree 同路径，再 commit。
 */
const createPrForClassEditsMethod: ObjectMethod<ThreadContext> = {
  name: "create_pr_for_class_edits",
  description:
    "Create a feat-branch PR for class-source edits in flow worktree. Returns prId.",
  schema: {
    paths: {
      type: "array",
      required: false,
      description: "源码路径列表（相对 stone repo root，如 objects/foo/executable/index.ts）；缺省 = 全部",
    },
    title: { type: "string", required: true, description: "PR title / commit message" },
  },
  permission: () => "allow",
  exec: async (ctx, self, args) => {
    requireSuperSession(ctx, "create_pr_for_class_edits");
    const title = typeof args.title === "string" ? args.title : "";
    if (!title.trim()) return { err: "[create_pr_for_class_edits] title required" };
    const callerObjectId = getCallerObjectId(self.data);
    const requestedPaths = Array.isArray(args.paths) ? (args.paths as string[]) : undefined;
    const hint = findCallerSessionId(self);

    const sessions = hint ? [hint] : await listBusinessSessions(ctx.worldDir);

    // 找第一个有 class edits 的 session（一般业务 session 只有 1 个）
    let edits: ClassEditEntry[] = [];
    let foundSid: string | undefined;
    for (const sid of sessions) {
      const r = await scanWorktreeClassEdits(ctx.worldDir, sid);
      if (r.length > 0) {
        edits = r;
        foundSid = sid;
        break;
      }
    }
    if (edits.length === 0) {
      return { err: "[create_pr_for_class_edits] no class edits found" };
    }
    if (!hint && foundSid) {
      await selfHealCallerSessionId(ctx, self, foundSid);
    }
    const toSend = requestedPaths
      ? edits.filter((e) => requestedPaths.includes(e.path))
      : edits;
    if (toSend.length === 0) {
      return { err: "[create_pr_for_class_edits] requested paths are not edited" };
    }

    const sessionWtPath = join(ctx.worldDir, "flows", foundSid!);

    const result = await createFeatBranchPr({
      baseDir: ctx.worldDir,
      intent: title,
      authorObjectId: callerObjectId,
      authorThreadId: self.data.id,
      writeFiles: async ({ worktreePath }) => {
        for (const e of toSend) {
          const src = join(sessionWtPath, e.path);
          const dest = join(worktreePath, e.path);
          await mkdir(dirname(dest), { recursive: true });
          await copyFile(src, dest);
        }
      },
    });

    if (!result.ok) {
      return { err: `[create_pr_for_class_edits] ${result.code}: ${result.message}` };
    }
    return {
      message:
        `[create_pr_for_class_edits] PR opened\n` +
        `  prId: ${result.prId}\n` +
        `  branch: ${result.featBranch}\n` +
        `  reviewers: ${result.reviewers.join(", ")}\n` +
        `  paths: ${result.paths.join(", ")}`,
      data: {
        prId: result.prId,
        featBranch: result.featBranch,
        reviewers: result.reviewers,
      },
    };
  },
};

export const reflectMethods: ObjectMethod<ThreadContext>[] = [
  scanChangesMethod,
  createPrForVersionedMethod,
  sedimentUnversionedMethod,
  createPrForClassEditsMethod,
];
