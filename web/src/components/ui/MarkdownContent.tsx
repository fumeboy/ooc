/**
 * MarkdownContent — Markdown 渲染组件
 *
 * 用于渲染对话消息和 Process 中的 thought/output 内容。
 * 支持 ooc:// 链接拦截，点击后打开 OocLinkPreview 弹窗。
 * 支持 [navigate] 块解析，渲染为 OocNavigateCard 卡片。
 */
import type { ReactNode, MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSetAtom } from "jotai";
import { oocLinkUrlAtom } from "../../store/ooc-link";
import { isOocUrl } from "../../lib/ooc-url";
import { cn } from "../../lib/utils";
import { parseNavigateBlocks } from "../../lib/navigate-parser";
import { OocNavigateCard } from "../OocNavigateCard";

interface MarkdownContentProps {
  content: string;
  className?: string;
  /** 是否在深色背景上（如用户消息气泡），链接颜色会自适应 */
  invertLinks?: boolean;
}

/** 将纯文本中的 ooc://xxx URL 转为 markdown 链接（已在 []() 中的不重复处理） */
function linkifyOocUrls(text: string): string {
  return text.replace(
    /(?<!\]\()(?<!\[)\b(ooc:\/\/[^\s)\]>]+)/g,
    (match) => `[${match}](${match})`,
  );
}

/** ReactMarkdown 自定义组件配置 */
function markdownComponents(setOocLink: (url: string) => void, invertLinks = false) {
  const linkClass = invertLinks
    ? "text-inherit underline underline-offset-2 opacity-90 hover:opacity-100 cursor-pointer"
    : "text-[var(--primary)] underline cursor-pointer";
  return {
    p: ({ children }: any) => <p className="my-1 leading-relaxed">{children}</p>,
    pre: ({ children }: any) => (
      <pre className="bg-[var(--muted)] rounded p-2 text-xs overflow-auto my-2 font-mono">
        {children}
      </pre>
    ),
    code: ({ children, className: codeClassName }: any) => {
      const isBlock = codeClassName?.startsWith("language-");
      if (isBlock) return <code>{children}</code>;
      return (
        <code className="bg-[var(--muted)] px-1 py-0.5 rounded text-xs font-mono">
          {children}
        </code>
      );
    },
    ul: ({ children }: any) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
    li: ({ children }: any) => <li className="text-sm">{children}</li>,
    h1: ({ children }: any) => <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-sm font-semibold mt-2 mb-0.5">{children}</h3>,
    table: ({ children }: any) => (
      <div className="overflow-auto my-2">
        <table className="text-xs border-collapse w-full">{children}</table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className="border border-[var(--border)] px-2 py-1 bg-[var(--muted)] text-left font-medium">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="border border-[var(--border)] px-2 py-1">{children}</td>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-2 border-[var(--border)] pl-3 my-2 text-[var(--muted-foreground)] italic">
        {children}
      </blockquote>
    ),
    a: ({ href, children }: any) => {
      if (href && isOocUrl(href)) {
        return (
          <a
            href={href}
            className={linkClass}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              setOocLink(href);
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a href={href} className={invertLinks ? linkClass : "text-[var(--primary)] underline"} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    hr: () => <hr className="my-3 border-[var(--border)]" />,
    strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
  };
}

export function MarkdownContent({ content, className, invertLinks }: MarkdownContentProps) {
  const setOocLink = useSetAtom(oocLinkUrlAtom);

  /* 预提取 [navigate] 块，替换为占位符 */
  const { cleanText, blocks } = parseNavigateBlocks(content);

  /* 如果没有 navigate 块，走原有渲染路径 */
  if (blocks.length === 0) {
    return (
      <div className={cn("prose prose-sm max-w-none break-words", className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents(setOocLink, invertLinks)}
        >
          {linkifyOocUrls(content)}
        </ReactMarkdown>
      </div>
    );
  }

  /* 有 navigate 块：按占位符分割，交替渲染 Markdown 和卡片 */
  const parts: ReactNode[] = [];
  let remaining = linkifyOocUrls(cleanText);

  for (let i = 0; i < blocks.length; i++) {
    const placeholder = `<!--ooc-nav-${i}-->`;
    const idx = remaining.indexOf(placeholder);
    if (idx === -1) continue;

    const before = remaining.slice(0, idx);
    remaining = remaining.slice(idx + placeholder.length);

    if (before.trim()) {
      parts.push(
        <ReactMarkdown key={`md-${i}`} remarkPlugins={[remarkGfm]} components={markdownComponents(setOocLink, invertLinks)}>
          {before}
        </ReactMarkdown>,
      );
    }

    const block = blocks[i]!;
    parts.push(
      <OocNavigateCard key={`nav-${i}`} title={block.title} description={block.description} url={block.url} />,
    );
  }

  if (remaining.trim()) {
    parts.push(
      <ReactMarkdown key="md-last" remarkPlugins={[remarkGfm]} components={markdownComponents(setOocLink, invertLinks)}>
        {remaining}
      </ReactMarkdown>,
    );
  }

  return (
    <div className={cn("prose prose-sm max-w-none break-words", className)}>
      {parts}
    </div>
  );
}
