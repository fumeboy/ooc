import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { parseOocUri } from "./oocUri";
import { splitOocText, hasOocUri } from "./oocText";
import { OocLink } from "./OocLink";

/**
 * 渲染 markdown 内容；通过 rehype-raw 解析嵌入的 inline HTML（如飞书文档导出
 * 在首部带的 `<title>...</title>` 标签）。
 *
 * 同时把 `ooc://client/...` 原生寻址 URI 渲染为 in-app 可点击导航（react-router
 * client-side，不整页 reload）：
 * - markdown 链接形态 `[label](ooc://client/...)`：由自定义 `a` component 拦截。
 * - 裸文本形态 `ooc://client/...`：先用 splitOocText 拆段，可识别段渲成 <OocLink>。
 * 无法识别的 ooc:// 形态降级为纯文本（parseOocUri 返回 null → 不拦截、不抛错）。
 *
 * 选择改这一层的理由：InlineUiContent 把所有 text 段都委托给 MarkdownContent；在此处统一
 * 拦截可一处覆盖 chat 正文里裸文本 + markdown 链接两种 ooc:// 出现形式，改动最内聚。
 *
 * 注意：rehype-raw 不做 sanitize，只展示**可信源**（OOC 内部文档、stone knowledge、
 * 飞书 docs +fetch 自有内容等）。如未来要展示用户上传 / 第三方 untrusted markdown
 * 应再叠 rehype-sanitize。
 */
export function MarkdownContent({ content }: { content: string }) {
  // 无可识别裸 ooc URI —— fast path，直接整段交给 markdown（markdown 链接形态仍由 a 组件处理）
  if (!hasOocUri(content)) {
    return <Markdown content={content} />;
  }
  const segments = splitOocText(content);
  return (
    <div className="markdown markdown-content">
      {segments.map((seg, idx) =>
        seg.kind === "text" ? (
          <Markdown key={idx} content={seg.text} bare />
        ) : (
          <OocLink key={idx} to={seg.route} uri={seg.uri}>
            {seg.uri}
          </OocLink>
        ),
      )}
    </div>
  );
}

/**
 * 单段 markdown 渲染。`bare` 时不再包外层 .markdown div（由上层 split 容器统一包裹）。
 */
function Markdown({ content, bare }: { content: string; bare?: boolean }) {
  const body = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{ a: OocAnchor }}
    >
      {content}
    </ReactMarkdown>
  );
  if (bare) return body;
  return <div className="markdown markdown-content">{body}</div>;
}

/**
 * 自定义 markdown `<a>`：href 为可识别 ooc://client URI 时换成 in-app <OocLink>；
 * 否则保持普通 anchor（https 等外链不受影响）。
 */
function OocAnchor({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) {
  const route = typeof href === "string" ? parseOocUri(href) : null;
  if (route !== null && typeof href === "string") {
    return (
      <OocLink to={route} uri={href}>
        {children}
      </OocLink>
    );
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
