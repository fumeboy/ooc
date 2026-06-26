/** plan —— 一个 agent 的计划：一组步骤（每步带状态）。 */
export interface PlanStep {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "done";
}

export interface Data {
  steps: PlanStep[];
  createdAt: number;
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
