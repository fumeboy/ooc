/**
 * Session-aware path 解析。
 *
 * OOC 设计：每个 session 持有一个 baseDir（通过 `--world` 启动；持久化到
 * thread.persistence.baseDir）。数据原语 (grep / glob / write_file / open_file /
 * file_window.edit) 接收 LLM 传入的相对路径时，应当解析到 baseDir，而不是
 * OOC 进程的 cwd——后者在多 session / 服务化场景毫无意义。
 *
 * stones routing：当路径形如 `stones/<id>/...` 时，自动重写为
 * `stones/<stonesBranch>/objects/<id>/...`：
 *   - U2 注入当前 server 实例绑定的 stones-branch（默认 main）
 *   - 2026-05-21 起，stone 对象统一落在 `stones/{branch}/objects/` 子目录下，
 *     让 stones/{branch}/ 根本身可承载 world-level stone 资源
 *
 * 注意：program(language="shell") 不走这里——shell 显式承诺"cwd 等于 OOC 进程的
 * 工作目录"，是 raw escape hatch（详见 src/executable/windows/root/command.program.ts 的
 * KNOWLEDGE）。
 */

import { isAbsolute, resolve } from "node:path";
import type { ThreadContext } from "../../../thinkable/context";

/**
 * 把 LLM 传入的路径解析为绝对路径：
 * - 绝对路径：原样返回
 * - 相对路径 + thread.persistence.baseDir 已知：相对 baseDir 解析；
 *   形如 `stones/<id>/...` 的路径自动注入当前 stonesBranch + `objects/`
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
 * 形如 `stones/<id>/...` 的路径中，若 `<id>` 不是已知的分支名前缀，则注入：
 *   - 当前 stonesBranch
 *   - `objects/` 中间层（per-Object 隔离）
 *
 * 即：`stones/agent_of_x/foo` → `stones/main/objects/agent_of_x/foo`
 *
 * 已经形如 `stones/main/...`、`stones/metaprog/...` 的路径不再重写（由 caller
 * 自己负责 main/ 之后的层级）；这些显式形态不会被自动加 `objects/`，因为它们
 * 可能想引用 world-level 资源（如 `stones/main/.gitignore`）。
 */
function rewriteStonesPath(p: string, stonesBranch: string): string {
  // 拆段；保留分隔符简单——内部使用 "/" 分隔，path.resolve 会再处理 "\\" 风格
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm.startsWith("stones/")) return p;
  const rest = norm.slice("stones/".length);
  if (rest.length === 0) return p;
  // 已经带 main/{...}: 直接放行（caller 自负 main/ 之后的层级）
  if (rest === "main" || rest.startsWith("main/")) return p;
  // metaprog/* 前缀（worktree 分支）：放行
  if (rest === "metaprog" || rest.startsWith("metaprog/")) return p;
  // 其它形态视为 LLM 写的 stones/<id>/...，注入 stonesBranch + objects/
  return `stones/${stonesBranch}/objects/${rest}`;
}

export const __testing = { rewriteStonesPath };
