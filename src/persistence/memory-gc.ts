/**
 * Memory GC —— 物理删除过期 entry + audit log（Phase 3）
 *
 * 设计要点：
 *
 * - **dry-run by default**：`OOC_MEMORY_GC=1` 才真正 unlink；默认只评估 + 写 audit log
 *   的 "dry_run" 标记行。这是"可怕操作必须显式授权"的安全边界——测试、CI、
 *   新环境首次跑都不会误删真 entry。
 *
 * - **TTL 规则**（与 queryMemoryEntries 过滤对齐）：
 *   1. `pinned === true` → 永不过期，跳过
 *   2. `ttlDays` 是 number → 过期时间 = createdAt + ttlDays * 24h
 *   3. `ttlDays === null`（默认）→ 使用 `DEFAULT_TTL_DAYS`（30 天）
 *
 * - **audit log**：`stones/{name}/memory/gc.log`（JSONL，append-only）
 *   每行一条 JSON：{ at, id, key, reason, ageMs, ttlDays, pinned, dryRun, deleted }
 *
 * - **embedding 同步清理**：真实删除时同步 deleteEmbedding
 *
 * - **纯数据层**：不调 LLM、不触碰 ThreadsTree；由调用方决定"何时"跑
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation_phase2.md — Phase 3
 */

import { existsSync, unlinkSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { readMemoryEntries, type MemoryEntry } from "./memory-entries.js";
import { deleteEmbedding } from "./memory-embedding.js";

/** 默认 TTL：未显式设 ttlDays 的 entry 视为 30 天过期 */
export const DEFAULT_TTL_DAYS = 30;

/** GC 参数 */
export interface MemoryGcOptions {
  /** 覆盖默认 TTL（测试用） */
  defaultTtlDays?: number;
  /** 覆盖 dry-run 语义；默认读 `OOC_MEMORY_GC` 环境变量（"1" → 真删） */
  forceRealDelete?: boolean;
  /** 基准时间（测试用；默认 Date.now()） */
  now?: number;
}

/** 单条 GC 决策记录（也是 audit log 行的 payload） */
export interface GcDecision {
  id: string;
  key: string;
  /** 跳过原因（pinned 或 fresh），或 "expired"（要删） */
  reason: "expired" | "pinned" | "fresh";
  /** entry 年龄（ms） */
  ageMs: number;
  /** 实际生效的 TTL 天数（null = pinned） */
  ttlDays: number | null;
  pinned: boolean;
  /** 是否实际物理删除（dry-run 模式下永远 false） */
  deleted: boolean;
}

/** GC 一次 run 的汇总 */
export interface GcRunSummary {
  stoneName: string;
  /** 扫描的 entry 总数 */
  scanned: number;
  /** 判定 expired 的条数（无论是否实删） */
  expired: number;
  /** 实际物理删除的条数（dry-run 时为 0） */
  deleted: number;
  /** 是否 dry-run */
  dryRun: boolean;
  /** 每条决策（scan 顺序） */
  decisions: GcDecision[];
  /** 完成时间 ISO */
  at: string;
}

/** 判断 `OOC_MEMORY_GC=1` 是否开启真删 */
function gcEnabledFromEnv(): boolean {
  const v = process.env.OOC_MEMORY_GC;
  return v === "1" || v === "true";
}

/**
 * 对单个 entry 做 GC 决策
 *
 * 返回 reason + 年龄 + 生效 TTL——不副作用、便于测试
 */
export function evaluateGcDecision(
  entry: MemoryEntry,
  now: number,
  defaultTtlDays: number,
): Omit<GcDecision, "deleted"> {
  const createdAtMs = new Date(entry.createdAt).getTime();
  const ageMs = Math.max(0, now - createdAtMs);

  if (entry.pinned) {
    return {
      id: entry.id,
      key: entry.key,
      reason: "pinned",
      ageMs,
      ttlDays: null,
      pinned: true,
    };
  }

  const effectiveTtlDays = entry.ttlDays ?? defaultTtlDays;
  const ttlMs = effectiveTtlDays * 24 * 3600 * 1000;
  const isExpired = ageMs > ttlMs;

  return {
    id: entry.id,
    key: entry.key,
    reason: isExpired ? "expired" : "fresh",
    ageMs,
    ttlDays: effectiveTtlDays,
    pinned: false,
  };
}

/**
 * 跑一次 GC（dry-run / real 由 env/options 决定）
 *
 * 顺序：
 * 1. 扫 `{selfDir}/memory/entries/*.json`
 * 2. 逐条评估决策
 * 3. 若 decision === "expired" 且非 dry-run → unlink entry + embedding
 * 4. 写一行 JSONL 到 `{selfDir}/memory/gc.log`（audit trail）
 * 5. 返回汇总
 */
export function runMemoryGc(
  selfDir: string,
  stoneName: string,
  options: MemoryGcOptions = {},
): GcRunSummary {
  const now = options.now ?? Date.now();
  const defaultTtl = options.defaultTtlDays ?? DEFAULT_TTL_DAYS;
  const realDelete = options.forceRealDelete ?? gcEnabledFromEnv();

  const entries = readMemoryEntries(selfDir);
  const decisions: GcDecision[] = [];
  let expired = 0;
  let deleted = 0;

  for (const e of entries) {
    const d = evaluateGcDecision(e, now, defaultTtl);
    let actuallyDeleted = false;
    if (d.reason === "expired") {
      expired++;
      if (realDelete) {
        const p = join(selfDir, "memory", "entries", `${e.id}.json`);
        try {
          if (existsSync(p)) {
            unlinkSync(p);
            actuallyDeleted = true;
            deleted++;
          }
          deleteEmbedding(selfDir, e.id);
        } catch {
          /* 删除失败——audit log 里仍记 "expired" 但 deleted=false */
        }
      }
    }
    decisions.push({ ...d, deleted: actuallyDeleted });
  }

  const summary: GcRunSummary = {
    stoneName,
    scanned: entries.length,
    expired,
    deleted,
    dryRun: !realDelete,
    decisions,
    at: new Date(now).toISOString(),
  };

  /* 写 audit log（即便 dry-run 也写，便于排查） */
  writeGcAuditLog(selfDir, summary);

  return summary;
}

/**
 * audit log 以 JSONL 追加到 `{selfDir}/memory/gc.log`
 *
 * 每次 run 会写 **多行**（每条决策一行）+ 一行 summary，便于离线分析。
 */
function writeGcAuditLog(selfDir: string, summary: GcRunSummary): void {
  const memDir = join(selfDir, "memory");
  try {
    if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
    const logPath = join(memDir, "gc.log");
    const lines: string[] = [];
    /* 每条决策单独一行 */
    for (const d of summary.decisions) {
      lines.push(JSON.stringify({
        at: summary.at,
        stoneName: summary.stoneName,
        dryRun: summary.dryRun,
        type: "decision",
        ...d,
      }));
    }
    /* 汇总行 */
    lines.push(JSON.stringify({
      at: summary.at,
      stoneName: summary.stoneName,
      dryRun: summary.dryRun,
      type: "summary",
      scanned: summary.scanned,
      expired: summary.expired,
      deleted: summary.deleted,
    }));
    appendFileSync(logPath, lines.join("\n") + "\n", "utf-8");
  } catch {
    /* audit 写失败不应影响 GC 本身——静默 */
  }
}
