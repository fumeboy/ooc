/**
 * Storybook 框架共享类型。
 *
 * storybook = OOC 能力目录：9 个特性（8 维度 + class），每个一个 story；
 * 每个 story 有两层（tier）：
 *  - control-plane（Tier A）：app.handle 进程内、确定性、零真 LLM、可进 CI gate。
 *  - agent-native（Tier B）：agent 在 thinkloop 亲手行使能力、过程可见、真 LLM、env-gated。
 */

export type CapabilityId =
  | "thinkable"
  | "executable"
  | "collaborable"
  | "observable"
  | "reflectable"
  | "programmable"
  | "visible"
  | "persistable"
  | "class";

export const CAPABILITIES: readonly CapabilityId[] = [
  "thinkable",
  "executable",
  "collaborable",
  "observable",
  "reflectable",
  "programmable",
  "visible",
  "persistable",
  "class",
] as const;

export type Tier = "control-plane" | "agent-native";

/** 单条测试用例结果。 */
export type TcResult = {
  id: string;
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
};

/** 一个 story 在某一 tier 跑完后的聚合结果。 */
export type StoryResult = {
  capability: CapabilityId;
  tier: Tier;
  /** 单 TC 级结果（control-plane 用）。 */
  tcs: TcResult[];
  /** story 级三档：全 PASS=Good；有 SKIP 无 FAIL=OK；有 FAIL=Bad。 */
  storyTier: "Good" | "OK" | "Bad";
  /** agent-native 用：agent 的可见动作轨迹摘要。 */
  trace?: string[];
};

/** 由单 TC 结果汇总 story 级三档。 */
export function rollupTier(tcs: TcResult[]): "Good" | "OK" | "Bad" {
  if (tcs.some((t) => t.status === "FAIL")) return "Bad";
  if (tcs.some((t) => t.status === "SKIP")) return "OK";
  if (tcs.length === 0) return "Bad";
  return "Good";
}
