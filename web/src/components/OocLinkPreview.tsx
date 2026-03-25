/**
 * OocLinkPreview —— ooc:// 链接弹窗预览
 *
 * 全局组件，监听 oocLinkUrlAtom，打开时解析 ooc:// URL 并展示内容。
 * - ooc://object/xxx → 对象摘要
 * - ooc://file/xxx/yyy → 文件内容（MarkdownContent 渲染）
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { oocLinkUrlAtom } from "../store/ooc-link";
import { resolveOocUrl } from "../api/client";
import { parseOocUrl } from "../lib/ooc-url";
import { MarkdownContent } from "./ui/MarkdownContent";
import { Sheet, SheetContent } from "./ui/sheet";

export function OocLinkPreview() {
  const [url, setUrl] = useAtom(oocLinkUrlAtom);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = url ? parseOocUrl(url) : null;

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    resolveOocUrl(url)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [url]);

  const open = !!url;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) setUrl(null); }}>
      <SheetContent side="right" className="w-[520px] max-w-[90vw] p-0 flex flex-col">
        {/* 头部 */}
        <div className="px-5 pt-5 pb-3 border-b border-[var(--border)] shrink-0">
          <div className="text-xs text-[var(--muted-foreground)] font-mono truncate pr-8">
            {url}
          </div>
          {parsed && (
            <div className="text-sm font-medium mt-1">
              {parsed.type === "object" ? `对象: ${parsed.name}` : `文件: ${parsed.filename}`}
            </div>
          )}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {loading && (
            <div className="text-sm text-[var(--muted-foreground)]">加载中...</div>
          )}
          {error && (
            <div className="text-sm text-red-500">加载失败: {error}</div>
          )}
          {!loading && !error && data && (
            parsed?.type === "object" ? (
              <ObjectPreview data={data} />
            ) : parsed?.type === "file" ? (
              <MarkdownContent content={data.content as string} />
            ) : null
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 对象摘要预览 */
function ObjectPreview({ data }: { data: Record<string, unknown> }) {
  const name = data.name as string;
  const talkable = data.talkable as { whoAmI: string; functions: { name: string; description: string }[] } | undefined;
  const traits = data.traits as string[] | undefined;
  const relations = data.relations as { name: string; description: string }[] | undefined;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold" style={{ fontFamily: "var(--heading-font)" }}>
          {name}
        </h3>
        {talkable?.whoAmI && (
          <p className="text-sm text-[var(--muted-foreground)] mt-1">{talkable.whoAmI}</p>
        )}
      </div>

      {talkable?.functions && talkable.functions.length > 0 && (
        <div>
          <div className="text-xs font-medium text-[var(--muted-foreground)] mb-1">Functions</div>
          <div className="space-y-1">
            {talkable.functions.map((f) => (
              <div key={f.name} className="text-xs">
                <span className="font-mono text-[var(--primary)]">{f.name}</span>
                <span className="text-[var(--muted-foreground)] ml-2">{f.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {traits && traits.length > 0 && (
        <div>
          <div className="text-xs font-medium text-[var(--muted-foreground)] mb-1">Traits</div>
          <div className="flex flex-wrap gap-1">
            {traits.map((t) => (
              <span key={t} className="text-xs bg-[var(--accent)] px-2 py-0.5 rounded">{t}</span>
            ))}
          </div>
        </div>
      )}

      {relations && relations.length > 0 && (
        <div>
          <div className="text-xs font-medium text-[var(--muted-foreground)] mb-1">Relations</div>
          <div className="space-y-1">
            {relations.map((r) => (
              <div key={r.name} className="text-xs">
                <span className="font-medium">{r.name}</span>
                <span className="text-[var(--muted-foreground)] ml-2">{r.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
