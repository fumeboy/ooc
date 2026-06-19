/**
 * ContextPipeline — 从 ThreadContext 分阶段构造 LLM context。
 *
 * 起点是 thread.contextWindows（持久窗口），各 processor 依次派生新窗口追加进来，
 * 最后 BudgetManager 按相关性打分 + 裁剪到预算，产出 ContextSnapshot。
 * buildInputItems 是本 pipeline 的薄封装。
 */
import type { ThreadContext } from "./index.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import type { ContextSnapshot } from "./snapshot.js";
import { BudgetManager, loadBudgetThresholds } from "./budget.js";
import { SystemProcessor } from "./processors/system.js";
import { ActivatorProcessor } from "./processors/activator.js";
import { PeerProcessor } from "./processors/peer.js";

export interface PipelinePhase {
  name: string;
  run(thread: ThreadContext, ctx: PipelineContext): OocObjectInstance[] | Promise<OocObjectInstance[]>;
}

export interface PipelineContext {
  windows: OocObjectInstance[];  // accumulated so far
}

export class ContextPipeline {
  private phases: PipelinePhase[] = [];

  addPhase(phase: PipelinePhase): void {
    this.phases.push(phase);
  }

  async run(thread: ThreadContext): Promise<ContextSnapshot> {
    // thread.contextWindows 已是 OocObjectInstance[]——pipeline 直接以实例信封为流通单元。
    const ctx: PipelineContext = { windows: [...(thread.contextWindows ?? [])] };

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
 * 1. SystemProcessor — builtin protocol knowledge + creator-reply + skill_index + self 类型注册
 * 2. ActivatorProcessor — frontmatter activates_on 触发的世界 stone/pool 知识激活
 * 3. PeerProcessor — peer/children Object 窗口
 *
 * BudgetManager.allocate 在所有相位之后于 pipeline.run() 内执行。
 */
export function createDefaultPipeline(): ContextPipeline {
  const p = new ContextPipeline();
  p.addPhase(SystemProcessor);
  p.addPhase(ActivatorProcessor);
  p.addPhase(PeerProcessor);
  return p;
}
