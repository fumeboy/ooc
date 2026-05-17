/**
 * Session-aware path 解析。
 *
 * OOC 设计：每个 session 持有一个 baseDir（通过 `--world` 启动；持久化到
 * thread.persistence.baseDir）。数据原语 (grep / glob / write_file / open_file /
 * file_window.edit) 接收 LLM 传入的相对路径时，应当解析到 baseDir，而不是
 * OOC 进程的 cwd——后者在多 session / 服务化场景毫无意义。
 *
 * 注意：program(language="shell") 不走这里——shell 显式承诺"cwd 等于 OOC 进程的
 * 工作目录"，是 raw escape hatch（详见 src/executable/windows/root/program.ts 的
 * KNOWLEDGE）。
 */

import { isAbsolute, resolve } from "node:path";
import type { ThreadContext } from "../../thinkable/context";

/**
 * 把 LLM 传入的路径解析为绝对路径：
 * - 绝对路径：原样返回
 * - 相对路径 + thread.persistence.baseDir 已知：相对 baseDir 解析
 * - 相对路径 + baseDir 未知：回退 process.cwd()（仅纯内存测试场景）
 */
export function resolveSessionPath(thread: ThreadContext | undefined, p: string): string {
  if (isAbsolute(p)) return p;
  const baseDir = thread?.persistence?.baseDir;
  return baseDir ? resolve(baseDir, p) : resolve(process.cwd(), p);
}
