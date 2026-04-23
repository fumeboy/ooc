/**
 * Edit Plan 持久化 —— 多文件原子编辑事务
 *
 * 背景：`file_ops.writeFile/editFile` 是单文件立即写入；跨文件重构
 * 中途失败会让仓库处于半改动态。本模块提供事务化能力：
 *
 *   1. plan_edits：收集一组 change，序列化成计划，不真写
 *   2. preview_edit_plan：返回 unified diff 供前端/LLM 预览
 *   3. apply_edits：原子应用；任一 change 失败全部回滚
 *
 * 设计：
 * - plan 持久化在 `flows/{sessionId}/edit-plans/{planId}.json`（若无 sessionId 则
 *   降级存到 `/tmp/ooc-edit-plans/{planId}.json`，测试常用此形态）
 * - apply 先读取所有原始内容（snapshot），计算完新内容后再逐文件写；
 *   写过程中任一失败立即按 snapshot 回滚已写部分
 * - plan 是 immutable 记录，apply 后状态变为 "applied"；失败状态 "failed"
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_multi_file_transaction.md
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** 单个 change —— 两种形态：局部编辑 or 整文件覆盖 */
export type EditChange =
  | {
      kind: "edit";
      /** 文件路径（相对 rootDir 或绝对） */
      path: string;
      /** 要查找的原文本 */
      oldText: string;
      /** 替换后的文本 */
      newText: string;
      /** 是否替换所有匹配（默认 false） */
      replaceAll?: boolean;
    }
  | {
      kind: "write";
      path: string;
      /** 整文件覆盖内容 */
      newContent: string;
    };

/** 一次 apply 的结果 */
export interface ApplyResult {
  /** 是否全部成功 */
  ok: boolean;
  /** 已成功应用的 change 数 */
  applied: number;
  /** 如有失败，错误信息 */
  error?: string;
  /**
   * 每个 change 的摘要
   * before/after：成功写入的文件，写盘前后的完整文本。
   * 前端用它在 thread view 渲染 diff 卡片（绿+/红- 高亮）。
   * 写新文件 before 为空串；失败 / 回滚的条目不带 before/after。
   */
  perChange: Array<{
    path: string;
    ok: boolean;
    bytesWritten?: number;
    error?: string;
    before?: string;
    after?: string;
  }>;
}

/** plan 状态机 */
export type PlanStatus = "pending" | "applied" | "failed" | "cancelled";

/** 持久化的 plan 结构（immutable） */
export interface EditPlan {
  planId: string;
  sessionId?: string;
  createdAt: number;
  status: PlanStatus;
  rootDir: string;
  changes: readonly EditChange[];
  /** apply 时写入 */
  appliedAt?: number;
  applyResult?: ApplyResult;
}

/** 生成 planId */
function newPlanId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `ep_${ts}_${rnd}`;
}

/** 获取 plan 目录 */
function planDir(sessionId?: string, flowsRoot?: string): string {
  if (sessionId && flowsRoot) {
    return join(flowsRoot, sessionId, "edit-plans");
  }
  return join("/tmp", "ooc-edit-plans");
}

function planFile(dir: string, planId: string): string {
  return join(dir, `${planId}.json`);
}

/** 相对路径 → 绝对路径 */
function resolvePath(rootDir: string, p: string): string {
  return p.startsWith("/") ? p : resolve(rootDir, p);
}

/**
 * 创建 plan：序列化 change 列表并持久化，不真写文件
 */
export async function createEditPlan(args: {
  rootDir: string;
  changes: EditChange[];
  sessionId?: string;
  flowsRoot?: string;
}): Promise<EditPlan> {
  const { rootDir, changes, sessionId, flowsRoot } = args;
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("changes 必须是非空数组");
  }
  for (const c of changes) {
    if (!c || typeof c.path !== "string" || c.path.length === 0) {
      throw new Error("每个 change 必须包含 path");
    }
    if (c.kind !== "edit" && c.kind !== "write") {
      throw new Error(`未知 change.kind: ${(c as any).kind}`);
    }
  }

  const plan: EditPlan = {
    planId: newPlanId(),
    sessionId,
    createdAt: Date.now(),
    status: "pending",
    rootDir,
    changes: Object.freeze([...changes]),
  };

  const dir = planDir(sessionId, flowsRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFile(planFile(dir, plan.planId), JSON.stringify(plan, null, 2), "utf-8");
  return plan;
}

/** 读取 plan */
export async function readEditPlan(
  planId: string,
  options?: { sessionId?: string; flowsRoot?: string },
): Promise<EditPlan | null> {
  const dir = planDir(options?.sessionId, options?.flowsRoot);
  const fp = planFile(dir, planId);
  if (!existsSync(fp)) return null;
  try {
    const text = await readFile(fp, "utf-8");
    return JSON.parse(text) as EditPlan;
  } catch {
    return null;
  }
}

/**
 * 生成 unified diff 预览
 *
 * MVP 实现：按 change 逐一生成简化 diff（--- path / +++ path / - oldText / + newText）。
 * 不追求 git 标准 hunk header，够人读即可。
 */
export async function previewEditPlan(plan: EditPlan): Promise<string> {
  const chunks: string[] = [];
  for (const c of plan.changes) {
    const abs = resolvePath(plan.rootDir, c.path);
    chunks.push(`--- a/${c.path}`);
    chunks.push(`+++ b/${c.path}`);
    if (c.kind === "edit") {
      chunks.push(`@@ edit (replaceAll=${c.replaceAll ?? false}) @@`);
      for (const line of c.oldText.split("\n")) chunks.push(`- ${line}`);
      for (const line of c.newText.split("\n")) chunks.push(`+ ${line}`);
    } else {
      chunks.push(`@@ write (full file overwrite) @@`);
      // 读原文件（若存在）显示 - 行
      try {
        if (existsSync(abs)) {
          const orig = await readFile(abs, "utf-8");
          for (const line of orig.split("\n")) chunks.push(`- ${line}`);
        } else {
          chunks.push(`- <file did not exist>`);
        }
      } catch {
        chunks.push(`- <unreadable>`);
      }
      for (const line of c.newContent.split("\n")) chunks.push(`+ ${line}`);
    }
    chunks.push("");
  }
  return chunks.join("\n");
}

/**
 * 应用 change：先读 snapshot，全部计算成功后再写；任一失败按 snapshot 回滚
 */
export async function applyEditPlan(
  plan: EditPlan,
  options?: { sessionId?: string; flowsRoot?: string },
): Promise<ApplyResult> {
  if (plan.status !== "pending") {
    return {
      ok: false,
      applied: 0,
      error: `plan 已是 ${plan.status} 状态，不能重复应用`,
      perChange: [],
    };
  }

  // 1) 读原始 snapshot
  type Snap = { abs: string; existed: boolean; original: string };
  const snaps: Snap[] = [];
  for (const c of plan.changes) {
    const abs = resolvePath(plan.rootDir, c.path);
    if (existsSync(abs)) {
      try {
        const original = await readFile(abs, "utf-8");
        snaps.push({ abs, existed: true, original });
      } catch (err: any) {
        const result: ApplyResult = {
          ok: false,
          applied: 0,
          error: `读取 snapshot 失败 ${c.path}: ${err?.message ?? err}`,
          perChange: [],
        };
        await persistPlanStatus(plan, "failed", result, options);
        return result;
      }
    } else {
      snaps.push({ abs, existed: false, original: "" });
    }
  }

  // 2) 预计算所有新内容（不写盘）
  type Prepared = { abs: string; newContent: string; bytes: number; path: string };
  const prepared: Prepared[] = [];
  for (let i = 0; i < plan.changes.length; i++) {
    const c = plan.changes[i]!;
    const snap = snaps[i]!;
    try {
      let newContent: string;
      if (c.kind === "write") {
        newContent = c.newContent;
      } else {
        // edit：在 snapshot.original 上做字符串替换
        if (!snap.existed) {
          throw new Error(`edit 目标文件不存在: ${c.path}`);
        }
        const text = snap.original;
        // 统计全部匹配数（无论 replaceAll 与否都要算，用于多匹配保护）
        const count = text.split(c.oldText).length - 1;
        if (count === 0) {
          throw new Error(`未找到匹配文本: ${c.path}`);
        }
        if (count > 1 && !c.replaceAll) {
          throw new Error(
            `${c.path} 找到 ${count} 处匹配，请使用 replaceAll 或更精确的 oldText`,
          );
        }
        newContent = c.replaceAll
          ? text.split(c.oldText).join(c.newText)
          : text.slice(0, text.indexOf(c.oldText)) +
            c.newText +
            text.slice(text.indexOf(c.oldText) + c.oldText.length);
      }
      prepared.push({
        abs: snap.abs,
        newContent,
        bytes: Buffer.byteLength(newContent, "utf-8"),
        path: c.path,
      });
    } catch (err: any) {
      const result: ApplyResult = {
        ok: false,
        applied: 0,
        error: `change[${i}] ${c.path}: ${err?.message ?? err}`,
        perChange: plan.changes.map((cc, j) => ({
          path: cc.path,
          ok: j < i,
          error: j === i ? String(err?.message ?? err) : undefined,
        })),
      };
      await persistPlanStatus(plan, "failed", result, options);
      return result;
    }
  }

  // 3) 全部计算通过，开始写盘；任一失败用 snapshot 回滚已写文件
  const written: number[] = []; // 已成功写入的 index
  const perChange: ApplyResult["perChange"] = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]!;
    try {
      const parent = dirname(p.abs);
      if (!existsSync(parent)) await mkdir(parent, { recursive: true });
      await writeFile(p.abs, p.newContent, "utf-8");
      written.push(i);
      perChange.push({
        path: p.path,
        ok: true,
        bytesWritten: p.bytes,
        // 暴露 before/after 给前端做 diff 渲染（写新文件 before 为空串）
        before: snaps[i]!.original,
        after: p.newContent,
      });
    } catch (err: any) {
      perChange.push({ path: p.path, ok: false, error: String(err?.message ?? err) });
      // 回滚
      for (const j of written) {
        const snap = snaps[j]!;
        try {
          if (snap.existed) {
            await writeFile(snap.abs, snap.original, "utf-8");
          } else {
            // 原来没有，回滚 = 删除
            await unlink(snap.abs).catch(() => {});
          }
        } catch {
          // 回滚失败只能吞掉，后面报告统一
        }
      }
      const result: ApplyResult = {
        ok: false,
        applied: 0,
        error: `change[${i}] 写入失败已回滚: ${err?.message ?? err}`,
        perChange,
      };
      await persistPlanStatus(plan, "failed", result, options);
      return result;
    }
  }

  const result: ApplyResult = {
    ok: true,
    applied: prepared.length,
    perChange,
  };
  await persistPlanStatus(plan, "applied", result, options);
  return result;
}

/** 更新 plan 状态并重新写盘 */
async function persistPlanStatus(
  plan: EditPlan,
  status: PlanStatus,
  applyResult: ApplyResult,
  options?: { sessionId?: string; flowsRoot?: string },
): Promise<void> {
  const dir = planDir(plan.sessionId ?? options?.sessionId, options?.flowsRoot);
  const fp = planFile(dir, plan.planId);
  const updated: EditPlan = {
    ...plan,
    status,
    appliedAt: Date.now(),
    applyResult,
  };
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await writeFile(fp, JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    // 写状态失败不影响 apply 本身的成功/失败结论
  }
}

/** 取消 plan（仅在 pending 时有效） */
export async function cancelEditPlan(
  plan: EditPlan,
  options?: { sessionId?: string; flowsRoot?: string },
): Promise<EditPlan> {
  if (plan.status !== "pending") return plan;
  const cancelled: EditPlan = { ...plan, status: "cancelled", appliedAt: Date.now() };
  const dir = planDir(plan.sessionId ?? options?.sessionId, options?.flowsRoot);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await writeFile(planFile(dir, plan.planId), JSON.stringify(cancelled, null, 2), "utf-8");
  } catch {
    // ignore
  }
  return cancelled;
}
