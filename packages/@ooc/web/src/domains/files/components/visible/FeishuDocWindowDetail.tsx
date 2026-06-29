/**
 * Feishu doc window 详情面板：markdown 长正文支持折叠。
 *
 * 从 ContextSnapshotViewer 内联组件抽出（线 A：统一 window 渲染解析层），签名统一为
 * `({ window }: { window: ContextWindow }) => JSX`。世界配置缓存（siteName / larkTenantHost）
 * 随组件一起迁出——本组件是唯一使用方。
 */
import React, { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ContextWindow } from "../../context-snapshot";
import { MarkdownContent } from "../../../../shared/ui/MarkdownContent";

type FeishuDocWindow = Extract<ContextWindow, { class: "feishu_doc" }>;

/**
 * 模块级缓存的 world config(siteName / larkTenantHost)。
 *
 * - 同一会话内多个 detail 组件共享一份;首次 mount 触发 fetch,后续直接返回。
 * - 10 秒 TTL 已经够用:siteName/larkTenantHost 几乎不会运行时改;真要刷只需 reload。
 * - 避免每个 feishu_doc detail 都自带 fetch 抖,也避免引入全局 Context。
 */
type WorldConfigCache = {
  siteName?: string;
  larkTenantHost?: string;
  hasLarkBot?: boolean;
};
let worldConfigCache: WorldConfigCache | null = null;
let worldConfigInflight: Promise<WorldConfigCache> | null = null;
let worldConfigFetchedAt = 0;
const worldConfigSubscribers = new Set<() => void>();

async function fetchWorldConfigCached(): Promise<WorldConfigCache> {
  const now = Date.now();
  if (worldConfigCache && now - worldConfigFetchedAt < 10_000) return worldConfigCache;
  if (worldConfigInflight) return worldConfigInflight;
  worldConfigInflight = (async () => {
    try {
      // 直接 fetch 避免引入 transport 依赖循环
      const res = await fetch("/api/world/config");
      const data = (await res.json()) as WorldConfigCache;
      worldConfigCache = data;
      worldConfigFetchedAt = Date.now();
      for (const cb of worldConfigSubscribers) cb();
      return data;
    } finally {
      worldConfigInflight = null;
    }
  })();
  return worldConfigInflight;
}

function useWorldConfig(): WorldConfigCache | null {
  const [, force] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchWorldConfigCached().then(() => {
      if (active) force((x) => x + 1);
    });
    const sub = () => active && force((x) => x + 1);
    worldConfigSubscribers.add(sub);
    return () => {
      active = false;
      worldConfigSubscribers.delete(sub);
    };
  }, []);
  return worldConfigCache;
}

/** kindSlug 映射;参考 spec:`https://{larkTenantHost}/{kindSlug}/{docToken}`。 */
function feishuDocKindSlug(kind: string): string {
  switch (kind) {
    case "docx": return "docx";
    case "doc": return "docs";
    case "sheet": return "sheets";
    case "base": return "base";
    case "wiki": return "wiki";
    case "drive_md": return "file";
    default: return kind;
  }
}

const FEISHU_DOC_PREVIEW_LIMIT = 400;

export default function FeishuDocWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as FeishuDocWindow;
  const config = useWorldConfig();
  const tenantHost = config?.larkTenantHost;
  const slug = feishuDocKindSlug(w.docKind);
  const docUrl = tenantHost ? `https://${tenantHost}/${slug}/${w.docToken}` : null;
  const lastFetched = w.lastFetchedAtMs
    ? new Date(w.lastFetchedAtMs).toLocaleString()
    : "(never)";

  const [expanded, setExpanded] = useState(false);
  const body = w.content?.body ?? "";
  const isMarkdown = w.content?.format === "markdown";
  const longBody = body.length > FEISHU_DOC_PREVIEW_LIMIT;
  const previewBody = longBody && !expanded ? body.slice(0, FEISHU_DOC_PREVIEW_LIMIT) + "…" : body;

  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">doc</span>
          <span className="llm-input-attr-value">
            {w.docTitle}{" "}
            {docUrl ? (
              <a href={docUrl} target="_blank" rel="noreferrer" className="cw-feishu-doc-link">
                <ExternalLink size={11} aria-hidden="true" /> open
              </a>
            ) : (
              <span className="muted small">(host 未配置)</span>
            )}
          </span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">kind / token</span>
          <span className="llm-input-attr-value">{w.docKind} · {w.docToken}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">mode</span>
          <span className="llm-input-attr-value">{w.mode}</span>
        </div>
        {w.versionId && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">version</span>
            <span className="llm-input-attr-value">{w.versionId}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">last fetched</span>
          <span className="llm-input-attr-value">{lastFetched}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">format</span>
          <span className="llm-input-attr-value">{w.content?.format ?? "(empty)"} · {body.length} chars</span>
        </div>
      </div>
      {body.length === 0 ? (
        <div className="llm-input-empty">content 为空;先用 read 拉一次。</div>
      ) : isMarkdown ? (
        <div className="llm-input-md-body">
          <MarkdownContent content={previewBody} />
          {longBody && (
            <button
              type="button"
              className="cw-feishu-doc-expand"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起" : `展开全文 (${body.length} 字)`}
            </button>
          )}
        </div>
      ) : (
        // blocks 形态:暂展示 body 字符串(后端通常是 with-ids XML 文本)
        <pre className="llm-input-pre">{previewBody}</pre>
      )}
      {!isMarkdown && longBody && (
        <div style={{ padding: "0 14px 12px" }}>
          <button
            type="button"
            className="cw-feishu-doc-expand"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : `展开全文 (${body.length} 字)`}
          </button>
        </div>
      )}
    </>
  );
}
