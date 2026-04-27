/**
 * web_search —— 互联网访问 kernel trait（Phase 2 协议：llm_methods 对象导出）
 *
 * 提供 DuckDuckGo 搜索和网页抓取能力。
 *
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 方法扩展对象能力
 */

import type { TraitMethod } from "../../../src/shared/types/index";

/** 将 HTML 转换为可读的纯文本 */
function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?(p|div|li|tr|h[1-6]|article|section|blockquote)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1]!.trim() : "";
}

async function searchImpl(
  _ctx: unknown,
  { query, maxResults = 8 }: { query: string; maxResults?: number },
): Promise<string> {
  try {
    const limit = Math.min(Math.max(1, maxResults), 20);
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "OOC-Browser/1.0 (Research Agent)",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return `[错误] 搜索失败: HTTP ${response.status}`;
    }

    const html = await response.text();

    const results: string[] = [];
    const resultBlocks =
      html.match(
        /<a[^>]*class="result__a"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>[\s\S]*?<\/a>/gi,
      ) ?? [];

    for (const block of resultBlocks.slice(0, limit)) {
      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
      const hrefMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>/i);

      if (titleMatch) {
        const title = htmlToText(titleMatch[1]!).trim();
        const snippet = snippetMatch ? htmlToText(snippetMatch[1]!).trim() : "";
        let href = hrefMatch?.[1] ?? "";
        const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch) href = decodeURIComponent(uddgMatch[1]!);
        results.push(`${title}\n  ${href}\n  ${snippet}`);
      }
    }

    if (results.length === 0) {
      const textContent = htmlToText(html);
      return `搜索 "${query}" 的结果:\n\n${textContent.slice(0, 5000)}`;
    }

    return `搜索 "${query}" 的结果 (${results.length} 条):\n\n${results.join("\n\n")}`;
  } catch (err: any) {
    return `[错误] 搜索失败: ${err?.message ?? String(err)}`;
  }
}

async function fetchPageImpl(
  _ctx: unknown,
  { url }: { url: string },
): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "OOC-Browser/1.0 (Research Agent)",
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return `[错误] HTTP ${response.status}: ${response.statusText}`;

    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = await response.text();

    const isHtml = contentType.includes("html") || rawBody.trimStart().startsWith("<");
    const title = isHtml ? extractTitle(rawBody) : "";
    const content = isHtml ? htmlToText(rawBody) : rawBody;

    const truncated =
      content.length > 15000
        ? content.slice(0, 15000) + "\n\n...[内容已截断，共 " + content.length + " 字符]"
        : content;

    return title ? `# ${title}\n\n${truncated}` : truncated;
  } catch (err: any) {
    return `[错误] 抓取失败: ${err?.message ?? String(err)}`;
  }
}

export const llm_methods: Record<string, TraitMethod> = {
  search: {
    name: "search",
    description: "通过 DuckDuckGo 搜索互联网",
    params: [
      { name: "query", type: "string", description: "搜索关键词", required: true },
      { name: "maxResults", type: "number", description: "最大返回数（默认 8，上限 20）", required: false },
    ],
    fn: searchImpl as TraitMethod["fn"],
  },
  fetchPage: {
    name: "fetchPage",
    description: "抓取网页内容，HTML 自动转纯文本",
    params: [
      { name: "url", type: "string", description: "网页 URL", required: true },
    ],
    fn: fetchPageImpl as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
