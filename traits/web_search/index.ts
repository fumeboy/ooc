/**
 * web_search —— 互联网访问 kernel trait
 *
 * 提供 DuckDuckGo 搜索和网页抓取能力，任何对象激活即可用。
 *
 * @ref .ooc/docs/哲学文档/gene.md#G3 — implements — Trait 方法扩展对象能力
 */

/** 将 HTML 转换为可读的纯文本 */
function htmlToText(html: string): string {
  let text = html;
  // 移除 script / style / noscript 标签及其内容
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  // 将块级标签转为换行
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(
    /<\/?(p|div|li|tr|h[1-6]|article|section|blockquote)[^>]*>/gi,
    "\n",
  );
  // 移除其余 HTML 标签
  text = text.replace(/<[^>]+>/g, " ");
  // 解码常见 HTML 实体
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
  // 清理多余空白
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}

/** 从 HTML 中提取 <title> */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1]!.trim() : "";
}

/**
 * 搜索互联网（通过 DuckDuckGo）
 * @param query - 搜索关键词
 * @param maxResults - 最大返回结果数（默认 8，最大 20）
 */
export async function search(ctx: any, query: string, maxResults: number = 8): Promise<string> {
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

    // 提取搜索结果：DuckDuckGo HTML 版的结果在 .result__a 和 .result__snippet 中
    const results: string[] = [];
    const resultBlocks =
      html.match(
        /<a[^>]*class="result__a"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>[\s\S]*?<\/a>/gi,
      ) ?? [];

    for (const block of resultBlocks.slice(0, limit)) {
      const titleMatch = block.match(
        /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const snippetMatch = block.match(
        /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const hrefMatch = block.match(
        /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>/i,
      );

      if (titleMatch) {
        const title = htmlToText(titleMatch[1]!).trim();
        const snippet = snippetMatch ? htmlToText(snippetMatch[1]!).trim() : "";
        // 解码 DuckDuckGo 重定向 URL（提取 uddg 参数中的真实 URL）
        let href = hrefMatch?.[1] ?? "";
        const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch) {
          href = decodeURIComponent(uddgMatch[1]!);
        }
        results.push(`${title}\n  ${href}\n  ${snippet}`);
      }
    }

    // 如果正则匹配失败，退回到全文提取
    if (results.length === 0) {
      const textContent = htmlToText(html);
      return `搜索 "${query}" 的结果:\n\n${textContent.slice(0, 5000)}`;
    }

    return `搜索 "${query}" 的结果 (${results.length} 条):\n\n${results.join("\n\n")}`;
  } catch (err: any) {
    return `[错误] 搜索失败: ${err?.message ?? String(err)}`;
  }
}

/**
 * 抓取网页内容，自动将 HTML 转为可读纯文本
 * @param url - 网页 URL
 */
export async function fetchPage(ctx: any, url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "OOC-Browser/1.0 (Research Agent)",
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return `[错误] HTTP ${response.status}: ${response.statusText}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = await response.text();

    // 如果是 HTML，转换为纯文本；否则直接使用
    const isHtml =
      contentType.includes("html") || rawBody.trimStart().startsWith("<");
    const title = isHtml ? extractTitle(rawBody) : "";
    const content = isHtml ? htmlToText(rawBody) : rawBody;

    // 限制内容长度防止 context 爆炸（保留前 15000 字符）
    const truncated =
      content.length > 15000
        ? content.slice(0, 15000) +
          "\n\n...[内容已截断，共 " +
          content.length +
          " 字符]"
        : content;

    return title ? `# ${title}\n\n${truncated}` : truncated;
  } catch (err: any) {
    return `[错误] 抓取失败: ${err?.message ?? String(err)}`;
  }
}
