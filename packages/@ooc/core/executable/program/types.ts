/** 用户代码执行结果。 */
export interface ProgramExecutionResult {
  /** 是否成功完成（无异常）。 */
  success: boolean;
  /** 用户代码 _result_ 的值；undefined 时表示用户没显式赋值。 */
  returnValue: unknown;
  /** 累积的 console 输出。 */
  stdout: string;
  /** 失败时的错误描述（含粗略行号定位）。 */
  error?: string;
}
