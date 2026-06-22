/**
 * `TODO(reason)` —— 退潮重构期的**编译期合法、运行期炸**占位。
 *
 * 用于「接口已修正、某条获取路径暂未接上」的断点：保留类型流通过 tsc，
 * 真跑到时立刻抛清晰错误，绝不静默返回错值。返回 `never` 故可填任何类型位
 * （`let thread: ThreadContext = TODO("获取 caller")`）。
 *
 * ⚠️ 仅限重构中转态——每个 TODO 都是一笔待还的债，落地验收须清零。
 */
export function TODO(reason: string): never {
  throw new Error(`[TODO] 未实现的获取路径：${reason}`);
}
