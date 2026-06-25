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
