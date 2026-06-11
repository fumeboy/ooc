/**
 * ContextPipeline — 从 ThreadContext 分阶段构造 LLM context。
 *
 * 起点是 thread.contextWindows（持久窗口），各 processor 依次派生新窗口追加进来，
 * 最后 BudgetManager 按相关性打分 + 裁剪到预算，产出 ContextSnapshot。
 * buildInputItems 是本 pipeline 的薄封装。
 */
import type { ThreadContext } from "./index.js";
import type { ContextWindow } from "../../executable/windows/_shared/types.js";
import type { ContextSnapshot } from "./snapshot.js";
import { BudgetManager, loadBudgetThresholds } from "./budget.js";
import { SystemProcessor } from "./processors/system.js";
import { WindowEnrichmentProcessor } from "./processors/enrichment.js";
import { ActivatorProcessor } from "./processors/activator.js";
import { PeerProcessor } from "./processors/peer.js";

export interface PipelinePhase {
  name: string;
  run(thread: ThreadContext, ctx: PipelineContext): ContextWindow[] | Promise<ContextWindow[]>;
}

export interface PipelineContext {
  windows: ContextWindow[];  // accumulated so far
}

export class ContextPipeline {
  private phases: PipelinePhase[] = [];

  addPhase(phase: PipelinePhase): void {
    this.phases.push(phase);
  }

  async run(thread: ThreadContext): Promise<ContextSnapshot> {
    // intentCache 的 lazy-init —— evaluateTrigger 的 intent case 会读 thread.intentCache。
    if (!thread.intentCache) thread.intentCache = new Map();
    // contextWindows 契约层是 base[]；narrow 回 union[] 以匹配 PipelineContext.windows。
    const ctx: PipelineContext = { windows: [...(thread.contextWindows ?? [])] as ContextWindow[] };

    for (const phase of this.phases) {
      const result = await phase.run(thread, ctx);
      if (result && result.length > 0) {
        ctx.windows.push(...result);
      }
    }

    // BudgetManager.allocate
    const budget = new BudgetManager();
    const thresholds = loadBudgetThresholds(thread);
    const { visible, overflow } = budget.allocate(ctx.windows, thresholds.hard);

    return {
      thread: { id: thread.id, status: thread.status },
      self: { objectId: thread.persistence?.objectId ?? "root" },
      windows: visible,
      overflow,
    } as ContextSnapshot;
  }
}

/**
 * 默认 pipeline 的相位顺序：
 * 1. SystemProcessor — root builtin protocol knowledge + creator-reply + skill_index + self 类型注册
 * 2. WindowEnrichmentProcessor — 沿 parentClass 链解析各窗口的 effectiveVisibleType
 * 3. ActivatorProcessor — frontmatter activates_on 触发的世界 stone/pool 知识激活
 * 4. PeerProcessor — peer/children Object 窗口
 *
 * BudgetManager.allocate 在所有相位之后于 pipeline.run() 内执行。
 */
export function createDefaultPipeline(): ContextPipeline {
  const p = new ContextPipeline();
  p.addPhase(SystemProcessor);
  p.addPhase(WindowEnrichmentProcessor);
  p.addPhase(ActivatorProcessor);
  p.addPhase(PeerProcessor);
  return p;
}
