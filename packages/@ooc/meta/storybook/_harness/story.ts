/**
 * 单元化 story 骨架。
 *
 * 与「9 个能力大 story」（stories/<cap>.story.ts 的 runControlPlane，一个函数多条 TC）不同，
 * 这里每条 story 只断**一个简单稳定的预期**：声明 id / expectation（≤100 字）/ design（锚定的 OOC 设计）
 * / run（断言体，失败即 throw）。由 stories/_catalog.test.ts 逐条收为一个 bun:test `it`，
 * 由 catalog-runner.ts 跑出 PASS/FAIL/SKIP 审计报告。
 *
 * 每条 story 独立拿一个 control-plane server（mkServer，进程内、零真 LLM），相互隔离——
 * 单元语义优先于复用 setup。
 *
 * 三态：
 *  - PASS：run 正常返回。
 *  - SKIP：run 调 skip(reason)——该预期控制面（无 worker/LLM）不可确定性验证，归 Tier B/e2e。
 *  - FAIL：run 因 check 失败 throw——**预期与实现的差异**，留待人裁决（改实现还是改预期）。
 */
import { mkServer, type CpServer } from "./control-plane";

export type StoryCtx = {
  app: CpServer["app"];
  baseDir: string;
};

export type StoryStatus = "PASS" | "FAIL" | "SKIP";

export type Story = {
  /** 稳定短 id，如 `L1-SESSION-WORKTREE`。 */
  id: string;
  /** 所属层，如 `session` / `persistable`。 */
  layer: string;
  /** 一句话预期（≤100 字）：简单、稳定、确定性。 */
  expectation: string;
  /** 它锚定的 OOC 设计（概念 + `file:行号`）。 */
  design: string;
  /**
   * 是否进 CI gate（`_catalog.test.ts`）。默认 true。
   * 设 false：该预期已知与实现有**差异**，留作审计（进报告）但不卡 gate，等人裁决。
   * 设 false 时应填 divergence 说明差异。
   */
  gate?: boolean;
  /** gate:false 时的差异说明（人裁决用）。 */
  divergence?: string;
  /** 断言体：失败即 throw（用 check）；不可验证则 skip()。 */
  run: (ctx: StoryCtx) => Promise<void>;
};

export function story(s: Story): Story {
  return s;
}

/** 断言：条件不成立即 throw，把 msg 作为失败详情。 */
export function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

class SkipSignal extends Error {
  readonly __skip = true;
}

/** 标记该预期控制面不可确定性验证（归 Tier B/e2e），runner 记为 SKIP（不计 FAIL）。 */
export function skip(reason: string): never {
  throw new SkipSignal(reason);
}

function isSkip(e: unknown): e is SkipSignal {
  return !!e && typeof e === "object" && (e as any).__skip === true;
}

/** 跑一条 story：起隔离 world → run → 必清理。失败 throw（供 bun:test gate）。 */
export async function runStory(s: Story): Promise<void> {
  const srv = await mkServer();
  try {
    await s.run({ app: srv.app, baseDir: srv.baseDir });
  } catch (e) {
    if (isSkip(e)) return; // gate 容忍 skip
    throw e;
  } finally {
    await srv.cleanup();
  }
}

/** 跑一条 story 并捕获三态结果（供 catalog-runner 审计报告）。 */
export async function runStoryCaptured(s: Story): Promise<{ status: StoryStatus; detail?: string }> {
  const srv = await mkServer();
  try {
    await s.run({ app: srv.app, baseDir: srv.baseDir });
    return { status: "PASS" };
  } catch (e) {
    if (isSkip(e)) return { status: "SKIP", detail: (e as Error).message };
    return { status: "FAIL", detail: (e as Error).message };
  } finally {
    await srv.cleanup();
  }
}
