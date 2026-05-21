/**
 * Inline UI component rendering — 解析消息文本中的 `[[ui{...}ui]]` token，
 * 渲染成可交互的小组件（file-link 等），与 Markdown 文本混排。
 *
 * 与 stones/main/user/readme.md 的语法约定保持一致；Agent 端只产 token 文本，
 * 前端集中 dispatch 渲染——不让 Agent 直接写 HTML，避免 XSS。
 */

import { Link, useLocation } from "react-router";
import { toPath } from "../../app/routing";
import { MarkdownContent } from "./MarkdownContent";

export type InlineUiSegment =
  | { kind: "text"; text: string }
  | { kind: "ui"; comp: string; props: Record<string, unknown> };

const UI_TOKEN_RE = /\[\[ui(\{[\s\S]*?\})ui\]\]/g;

/**
 * 把消息文本切分为 [text, ui, text, ...] 段。
 *
 * - JSON 解析失败的 token：当作普通文本保留
 * - 缺 `comp` 字段或 `comp` 非 string：当作普通文本保留
 */
export function parseInlineUiSegments(content: string): InlineUiSegment[] {
  const segments: InlineUiSegment[] = [];
  let lastIdx = 0;
  // matchAll 不带 lastIndex 状态，比 exec 安全
  for (const match of content.matchAll(UI_TOKEN_RE)) {
    const tokenStart = match.index ?? 0;
    if (tokenStart > lastIdx) {
      segments.push({ kind: "text", text: content.slice(lastIdx, tokenStart) });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      segments.push({ kind: "text", text: match[0] });
      lastIdx = tokenStart + match[0].length;
      continue;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).comp === "string"
    ) {
      const obj = parsed as Record<string, unknown> & { comp: string };
      const { comp, ...props } = obj;
      segments.push({ kind: "ui", comp, props });
    } else {
      segments.push({ kind: "text", text: match[0] });
    }
    lastIdx = tokenStart + match[0].length;
  }
  if (lastIdx < content.length) {
    segments.push({ kind: "text", text: content.slice(lastIdx) });
  }
  return segments;
}

/**
 * 真正渲染消息内容。无 UI token 时直接走原 MarkdownContent，行为不变；有 token
 * 时按 segments 顺序渲染（block 级），每个 ui-token 渲染对应 React 组件。
 */
export function InlineUiContent({ content }: { content: string }) {
  // 大多数消息没有 ui token —— fast path 维持原行为
  if (!content.includes("[[ui")) {
    return <MarkdownContent content={content} />;
  }
  const segments = parseInlineUiSegments(content);
  if (segments.length === 1 && segments[0].kind === "text") {
    return <MarkdownContent content={segments[0].text} />;
  }
  return (
    <div className="inline-ui-container">
      {segments.map((seg, idx) =>
        seg.kind === "text" ? (
          <MarkdownContent key={idx} content={seg.text} />
        ) : (
          <InlineUiComponent key={idx} comp={seg.comp} props={seg.props} />
        ),
      )}
    </div>
  );
}

function InlineUiComponent({ comp, props }: { comp: string; props: Record<string, unknown> }) {
  if (comp === "file-link") return <FileLinkInline props={props} />;
  return (
    <code className="inline-ui-unknown" title={`unknown ui component: ${comp}`}>
      [unknown ui: {comp}]
    </code>
  );
}

function FileLinkInline({ props }: { props: Record<string, unknown> }) {
  const path = typeof props.path === "string" ? props.path : "";
  const location = useLocation();
  if (!path) return null;
  const label = typeof props.label === "string" && props.label.length > 0 ? props.label : path;
  // 保留 thread 上下文：当前 URL 带的 ?sessionId/objectId/threadId 沿用过去，让
  // 跳到 file viewer 后右侧 chat panel 持续显示。无 thread 上下文则降级到普通 file URL。
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("sessionId") ?? extractSessionFromPath(location.pathname);
  const objectId = params.get("objectId");
  const threadId = params.get("threadId");
  const thread =
    sessionId && objectId && threadId ? { sessionId, objectId, threadId } : undefined;
  const href = toPath({ kind: "file", path: path.replace(/^\/+/, ""), thread });
  return (
    <Link className="inline-ui-file-link" to={href} title={path}>
      {label}
    </Link>
  );
}

/**
 * 当 URL 是 `/flows/<sid>` 或 `/flows/<sid>?...` 时取出 sessionId；其它路径返回 null。
 * 用于 file-link 在 session 路由下也能继承 sessionId 到 file 视图。
 */
function extractSessionFromPath(pathname: string): string | null {
  const m = /^\/flows\/([^/?#]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}
