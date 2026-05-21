/**
 * Issue / Comment 持久化层 —— 纯类型 + 文件 IO。
 *
 * 不在此处做并发保护、id 分配、订阅扇出等业务,全部留给
 * `src/persistable/issue-service.ts`(U2)。本文件只是 schema + reader/writer。
 *
 * 文件布局(对应 origin §3.1):
 *   flows/{sessionId}/issues/
 *     issue-{id}.json   ← 单 Issue 的完整内容(description + comments[])
 *     index.json        ← session 内所有 Issue 的摘要 + nextId
 *
 * 不在 flow-object 的 objects/ 下面 —— Issue 是 session 级共享资源,跨多个
 * flow object 共用(spec.sessionScope)。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { toJson } from "./common";

/** 单条评论:Issue 内部按 id 单调递增追加。 */
export interface Comment {
  /** Issue 内部的序号(1-based,按追加顺序分配);同 Issue 内唯一。 */
  id: number;
  /** 评论文本;最大长度由 service 层校验(本文件不限)。 */
  text: string;
  /** 作者 objectId(对应 stones/<objectId> 目录);service 层负责校验存在。 */
  authorObjectId: string;
  /** 作者来源:"llm" 表示由 LLM 命令写入,"user" 表示由 HTTP 直接写入。 */
  authorKind: "llm" | "user";
  /** 解析后的 @mention objectId 列表(并集去重);worker pull 与 push 读这里判定唤醒目标。 */
  mentions: string[];
  /** 创建时间戳(ms);用于排序与调试,不承担强一致时钟语义。 */
  createdAt: number;
}

/** 单个 Issue 的磁盘形态。 */
export interface Issue {
  /** Issue 在所属 session 内的全局 id;由 service 层从 index.nextId 分配。 */
  id: number;
  /** 简短标题(创建时由发起方提供)。 */
  title: string;
  /** 详情描述(可选;LLM 创建时常含决策背景)。 */
  description?: string;
  /** Issue 自身状态;只能 open → closed,一旦 closed 不再接受 comment。 */
  status: "open" | "closed";
  /** 创建者 objectId。 */
  createdByObjectId: string;
  /** 创建时间戳(ms)。 */
  createdAt: number;
  /** 最后一次写入(评论 / close)时间戳(ms);用于排序与调试。 */
  lastUpdatedAt: number;
  /** 评论流,按 id 单调递增追加;LLM derive 时通常只展示最后 N 条 + description。 */
  comments: Comment[];
  /**
   * U5: PR-Issue payload —— 当 Object 元编程跨自治区、需 Supervisor 评审时附带。
   * 非 PR 类 Issue 该字段 undefined。详见 docs/plans/2026-05-20-001-feat-stones-git-versioning-plan.md U5。
   */
  prPayload?: PrIssuePayload;
}

/**
 * PR-Issue 载荷：Object 在 worktree 内 commit 后请求 cross-scope merge 时填。
 * Supervisor 在自己的 super flow 中读到该 Issue 即可看到 diff、修改意图、来源 worktree。
 */
export interface PrIssuePayload {
  /** 修改意图说明(LLM 自由文本，长度由 service 层校验)。 */
  intent: string;
  /** 待评审的 worktree branch 名（如 `metaprog/agent_of_x/abc123`）。 */
  branch: string;
  /**
   * branch 相对 main merge-base 的累积 patch（unified diff 文本）。Supervisor
   * 看到的就是这段——不是 inline 单行 hunk，而是完整可读的 diff。
   */
  diff: string;
  /** 涉及的文件路径列表（diff 解析后的相对 stones/ 根的路径，便于 list 端只读 names）。 */
  paths: string[];
  /** 触发 PR 时的 main HEAD sha（Supervisor 决议时验证 base 未飘）。 */
  baseSha: string;
}

/** index.json 内对单个 Issue 的摘要条目(避免列表渲染时全量加载 issue-*.json)。 */
export interface IssueIndexEntry {
  /** 与 Issue.id 对应。 */
  id: number;
  /** 与 Issue.title 同步。 */
  title: string;
  /** 与 Issue.status 同步。 */
  status: "open" | "closed";
  /** 评论数;每次 appendComment 后 +1。 */
  commentCount: number;
  /** 创建者 objectId(用于 list 时直接显示)。 */
  createdByObjectId: string;
  /** 创建时间戳(ms)。 */
  createdAt: number;
  /** 最后一次写入(评论 / close)时间戳(ms)。 */
  lastUpdatedAt: number;
}

/** index.json 整体形态:nextId 单调递增 id 分配器 + Issue 摘要列表。 */
export interface IssueIndex {
  /** 下一个 Issue 将分配到的 id;service.createIssue 取走后 +1 再写回。 */
  nextId: number;
  /** Issue 摘要列表,按 createdAt 顺序;list endpoint 直接返回这里。 */
  issues: IssueIndexEntry[];
}

/**
 * sessionId 严格校验:防 path-traversal 与非法字符(S1)。
 *
 * 允许 64 字符以内的字母 / 数字 / 下划线 / 短横线;不允许 `.` `/` `\` `..` 等。
 * 与 `flows` module 的 sessionIdParams 比起来更严,因为这里要拼绝对文件路径,
 * 容不下任何 percent-encoded 绕过。
 */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function ensureSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`[issue] invalid sessionId: ${JSON.stringify(sessionId)}`);
  }
}

function ensureIssueId(issueId: number): void {
  if (!Number.isInteger(issueId) || issueId < 1) {
    throw new Error(`[issue] invalid issueId: ${issueId}`);
  }
}

/** `flows/{sessionId}/issues/` 子目录绝对路径。 */
function issuesDir(baseDir: string, sessionId: string): string {
  ensureSessionId(sessionId);
  return join(baseDir, "flows", sessionId, "issues");
}

/** 单个 Issue 的文件绝对路径。 */
export function issueFile(baseDir: string, sessionId: string, issueId: number): string {
  ensureIssueId(issueId);
  return join(issuesDir(baseDir, sessionId), `issue-${issueId}.json`);
}

/** index.json 的文件绝对路径。 */
export function issueIndexFile(baseDir: string, sessionId: string): string {
  return join(issuesDir(baseDir, sessionId), "index.json");
}

/** 读取 Issue;不存在返回 undefined(ENOENT 静默);JSON 异常抛错给 caller。 */
export async function readIssue(
  baseDir: string,
  sessionId: string,
  issueId: number,
): Promise<Issue | undefined> {
  try {
    const text = await readFile(issueFile(baseDir, sessionId, issueId), "utf8");
    return JSON.parse(text) as Issue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 Issue;自动 mkdir recursive(issues/ 子目录可能首次创建)。 */
export async function writeIssue(baseDir: string, sessionId: string, issue: Issue): Promise<void> {
  const path = issueFile(baseDir, sessionId, issue.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toJson(issue), "utf8");
}

/** 读取 index;不存在返回空 `{ nextId: 1, issues: [] }`(便于首次创建)。 */
export async function readIssueIndex(baseDir: string, sessionId: string): Promise<IssueIndex> {
  try {
    const text = await readFile(issueIndexFile(baseDir, sessionId), "utf8");
    return JSON.parse(text) as IssueIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { nextId: 1, issues: [] };
    }
    throw error;
  }
}

/** 写入 index;自动 mkdir recursive。 */
export async function writeIssueIndex(
  baseDir: string,
  sessionId: string,
  index: IssueIndex,
): Promise<void> {
  const path = issueIndexFile(baseDir, sessionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toJson(index), "utf8");
}
