/**
 * issue_window — 已订阅的 Issue 的命令面与基础知识。
 *
 * 注册的 command:
 * - comment: 发表一条 Issue 评论;支持 structured mentions 参数(P1)+ 文本正则
 *   double-track,resolved_mentions 取并集去重
 *
 * 不注册 close hook(F3 决议):用通用 close 原语;close 即从本 thread.contextWindows
 * 移除 window,Issue 文件不动;其它 thread 不受影响。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import { registerWindowType, type RenderContext } from "../_shared/registry.js";
import { issuesService } from "../../../persistable/index.js";
import { xmlElement, xmlText, type XmlNode } from "../../../thinkable/context/xml.js";
import type { IssueWindow } from "./types.js";

const ISSUE_COMMENT_BASIC = "internal/windows/issue/comment/basic";
const ISSUE_COMMENT_INPUT = "internal/windows/issue/comment/input";

/** issue_window 的 type-level basicKnowledge。 */
const ISSUE_WINDOW_BASIC_KNOWLEDGE = `
issue_window 是对 session 内某个 Issue 的订阅入口。它注册的 command 不在 root 上,
要通过 open(parent_window_id="<issue_window_id>", command="...", args={...}) 调用:

| command | 作用 | 典型用法 |
|---------|------|----------|
| comment | 在 Issue 上发表评论;可显式声明 mention 唤醒目标 | open(parent_window_id="<issue_window_id>", command="comment", args={ text: "...", mentions: ["alice"] }) |
| close   | 解订阅(本 thread 退出该 Issue,Issue 文件不动)   | close(window_id="<issue_window_id>", reason="...") |

**重要**:
- close 只是**本 thread 退订**;其它 thread 不受影响;Issue 自身仍在 session 中
  存在。想重新订阅 → \`open(command="open_issue", args={ issueId: N })\`,新 window
  仍能在 derive body 看到完整 Issue 历史
- comment 的 mention 双轨:
  - 文本 \`@<objectId>\` 正则解析
  - **推荐** 通过 \`mentions: ["a", "b"]\` 显式声明 — 不依赖文本格式,不会因 LLM
    忘记前置空白而漏掉
  - 两路取并集去重,resolved_mentions 在 command output 里反馈
- 同一 thread 同一 issueId 只挂一个 issue_window;create_issue/open_issue 都做 dedup
`.trim();

const COMMENT_KNOWLEDGE = `
issue_window.comment 用于在本 issue_window 对应的 Issue 上追加一条评论。

参数:
- text: 必填,评论正文(最大 4096 字符)
- mentions: 可选 string[],显式声明要唤醒的 objectId(推荐使用,不依赖文本 @ 解析)

行为:
- 写 issue-{id}.json 的 comments[];comment.mentions = parseMentions(text) ∪ args.mentions(去重)
- service 自动按订阅 thread 推送(F4 push 路径);@self 的 thread 会被 enqueue 一个
  run-thread job 到 worker;不持有该 Issue 的 thread 不会被唤醒
- 写入成功 → command output 含 \`comment#<id>;resolved mentions: [...]\`
- Issue 已关闭 → 写入失败

推荐用法(一步到位,args 齐时 open 立即提交):
  open(parent_window_id="<issue_window_id>", command="comment", title="评估结果",
       args={ text: "我觉得 X 改名为 Y 更好。@critic 复核一下?",
              mentions: ["critic"] })
`.trim();

const commentCommand: CommandTableEntry = {
  paths: ["comment"],
  match: () => ["comment"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [ISSUE_COMMENT_BASIC]: COMMENT_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.text !== "string" || args.text.trim().length === 0) {
      entries[ISSUE_COMMENT_INPUT] =
        'issue_window.comment 需要 text;用 refine(args={ text: "...", mentions: ["..."]? })。';
    }
    return entries;
  },
  exec: (ctx) => executeIssueWindowComment(ctx),
};

export async function executeIssueWindowComment(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[issue_window.comment] 缺少 thread context。";
  const window = ctx.parentWindow;
  if (!window || window.type !== "issue") {
    return "[issue_window.comment] 未挂载在 issue_window 上。";
  }
  if (!thread.persistence) {
    return "[issue_window.comment] 当前 thread 无 persistence,无法写入。";
  }

  const text = typeof ctx.args.text === "string" ? ctx.args.text : "";
  if (!text.trim()) return "[issue_window.comment] 缺少 text。";

  const mentions = Array.isArray(ctx.args.mentions)
    ? (ctx.args.mentions as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : undefined;

  let commentId: number;
  let resolved: string[];
  try {
    const r = await issuesService.appendComment({
      baseDir: thread.persistence.baseDir,
      sessionId: thread.persistence.sessionId,
      issueId: window.issueId,
      text,
      authorObjectId: thread.persistence.objectId,
      authorKind: "llm",
      mentions,
    });
    commentId = r.commentId;
    resolved = r.resolved_mentions;
  } catch (error) {
    return `[issue_window.comment] 写入失败: ${(error as Error).message}`;
  }

  // 更新本 window 的 lastSeenCommentId,防止下一轮 syncIssueWindowComments 把
  // 自己刚发的 comment 视作 new(虽然 self-skip 也会跳过 author=self,但游标
  // 同步更准确)。lastSeenCommentId 是 in-process 字段,直接 mutate window 即可
  // (不持久化)。
  window.lastSeenCommentId = commentId;

  return `[issue_window.comment] 已发表 comment#${commentId};resolved mentions: ${
    resolved.length > 0 ? `[${resolved.join(", ")}]` : "(无)"
  }`;
}

/**
 * issue_window 的 renderXml hook：dump issueId + lastSeen 游标。
 *
 * Issue 的具体内容（title / status / comments）由 deriveIssueWindowKnowledge
 * 派生为伴随的 KnowledgeWindow 渲染；本 window 只负责暴露订阅入口元信息。
 */
function renderIssueWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as IssueWindow;
  const children: XmlNode[] = [
    xmlElement("issue_id", {}, [xmlText(String(window.issueId))]),
  ];
  if (typeof window.lastSeenCommentId === "number") {
    children.push(xmlElement("last_seen_comment_id", {}, [xmlText(String(window.lastSeenCommentId))]));
  }
  return children;
}

registerWindowType("issue", {
  commands: {
    comment: commentCommand,
  },
  renderXml: renderIssueWindow,
  basicKnowledge: ISSUE_WINDOW_BASIC_KNOWLEDGE,
});
