/**
 * method_exec_form —— 填表式渐进执行的 form data。
 *
 * 用于支持 ObjectMethod.route 模式：method 声明 route 后，调用时先开 form 而非直接 exec；
 * LLM 经 refine 累积 args、route 重算 tip/intents → 知识激活，最后 submit 才真 exec。
 */
export interface Data {
  /** 目标 object id（被调用对象）。 */
  targetObjectId: string;
  /** 目标 method 名。 */
  targetMethod: string;
  /** 累积参数。 */
  accumulatedArgs: Record<string, unknown>;
  /** 最近一次 route 计算出的 tip（人读提示）。 */
  tip?: string;
  /** 最近一次 route 计算出的 intents（驱动知识激活）。 */
  intents?: string[];
  createdAt: number;
}
