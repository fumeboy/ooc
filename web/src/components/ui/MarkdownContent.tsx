/**
 * MarkdownContent — Markdown 渲染组件
 *
 * 用于渲染对话消息和 Process 中的 thought/output 内容。
 * 支持 ooc:// 链接拦截，点击后打开 OocLinkPreview 弹窗。
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSetAtom } from "jotai";
import { oocLinkUrlAtom } from "../../store/ooc-link";
import { isOocUrl } from "../../lib/ooc-url";
import { cn } from "../../lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/** 将纯文本中的 ooc://xxx URL 转为 markdown 链接（已在 []() 中的不重复处理） */
function linkifyOocUrls(text: string): string {
  return text.replace(
    /(?<!\]\()(?<!\[)\b(ooc:\/\/[^\s)\]>]+)/g,
    (match) => `[${match}](${match})`,
  );
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const setOocLink = useSetAtom(oocLinkUrlAtom);

  return (
    <div className={cn("prose prose-sm max-w-none break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
          pre: ({ children }) => (
            <pre className="bg-[var(--muted)] rounded p-2 text-xs overflow-auto my-2 font-mono">
              {children}
            </pre>
          ),
          code: ({ children, className: codeClassName }) => {
            const isBlock = codeClassName?.startsWith("language-");
            if (isBlock) return <code>{children}</code>;
            return (
              <code className="bg-[var(--muted)] px-1 py-0.5 rounded text-xs font-mono">
                {children}
              </code>
            );
          },
          ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-sm">{children}</li>,
          h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-0.5">{children}</h3>,
          table: ({ children }) => (
            <div className="overflow-auto my-2">
              <table className="text-xs border-collapse w-full">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[var(--border)] px-2 py-1 bg-[var(--muted)] text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--border)] px-2 py-1">{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--border)] pl-3 my-2 text-[var(--muted-foreground)] italic">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => {
            if (href && isOocUrl(href)) {
              return (
                <a
                  href={href}
                  className="text-[var(--primary)] underline cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    setOocLink(href);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} className="text-[var(--primary)] underline" target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          hr: () => <hr className="my-3 border-[var(--border)]" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {linkifyOocUrls(content)}
      </ReactMarkdown>
    </div>
  );
}
