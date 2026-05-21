/**
 * Session-aware path 解析。
 *
 * OOC 设计：每个 session 持有一个 baseDir（通过 `--world` 启动；持久化到
 * thread.persistence.baseDir）。数据原语 (grep / glob / write_file / open_file /
 * file_window.edit) 接收 LLM 传入的相对路径时，应当解析到 baseDir，而不是
 * OOC 进程的 cwd——后者在多 session / 服务化场景毫无意义。
 *
 * U2 stones-branch routing：当路径形如 `stones/<id>/...` 时，自动重写为
 * `stones/<stonesBranch>/<id>/...`，让 LLM 沿用既有 `stones/<self>/foo` 写法
 * 时也能正确落到当前 server 实例绑定的 stones-branch（默认 main，worktree 子
 * Server 时是 metaprog/.../...）。
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
 * - 相对路径 + thread.persistence.baseDir 已知：相对 baseDir 解析；
 *   形如 `stones/<id>/...` 的路径自动注入当前 stonesBranch（默认 "main"）
 * - 相对路径 + baseDir 未知：回退 process.cwd()（仅纯内存测试场景）
 */
export function resolveSessionPath(thread: ThreadContext | undefined, p: string): string {
  if (isAbsolute(p)) return p;
  const baseDir = thread?.persistence?.baseDir;
  if (!baseDir) return resolve(process.cwd(), p);

  const rewritten = rewriteStonesPath(p, thread?.persistence?.stonesBranch ?? "main");
  return resolve(baseDir, rewritten);
}

/**
 * 形如 `stones/<id>/...` 的路径中，若 `<id>` 不是已知的分支名（非 "main" 且不是
 * `stones/{branch}/...` 格式），则注入当前 stonesBranch。
 *
 * 已经形如 `stones/main/<id>/...` 或 `stones/metaprog/.../<id>/...` 的路径不再重写。
 */
function rewriteStonesPath(p: string, stonesBranch: string): string {
  // 拆段；保留分隔符简单——内部使用 "/" 分隔，path.resolve 会再处理 "\\" 风格
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm.startsWith("stones/")) return p;
  const rest = norm.slice("stones/".length);
  if (rest.length === 0) return p;
  // 已经带 main/{...}: 直接放行
  if (rest === "main" || rest.startsWith("main/")) return p;
  // metaprog/* 前缀（worktree 分支）：放行
  if (rest === "metaprog" || rest.startsWith("metaprog/")) return p;
  // 其它形态视为 LLM 写的 stones/<id>/...，注入 stonesBranch
  return `stones/${stonesBranch}/${rest}`;
}

export const __testing = { rewriteStonesPath };
