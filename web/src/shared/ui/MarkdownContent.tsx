import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

/**
 * 渲染 markdown 内容；通过 rehype-raw 解析嵌入的 inline HTML（如飞书文档导出
 * 在首部带的 `<title>...</title>` 标签）。
 *
 * 注意：rehype-raw 不做 sanitize，只展示**可信源**（OOC 内部文档、stone knowledge、
 * 飞书 docs +fetch 自有内容等）。如未来要展示用户上传 / 第三方 untrusted markdown
 * 应再叠 rehype-sanitize。
 */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
