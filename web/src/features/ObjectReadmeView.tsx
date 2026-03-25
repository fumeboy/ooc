/**
 * ObjectReadmeView — 对象 Readme 展示组件（共享）
 *
 * 两栏布局：左侧 Readme 内容 / 右侧 Traits 列表 + Public Methods
 * 点击 Trait 弹出模态窗查看详情。
 *
 * 同时被 ObjectDetail（Stone 视图）和 ChatContent（Flow 视图）复用。
 */
import { useState, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import Avatar from "boring-avatars";
import { fetchReadme, fetchTraits } from "../api/client";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import type { TraitInfo } from "../api/types";

/** 解析 frontmatter（---...--- 块） */
function parseFrontmatter(raw: string): { frontmatter: Record<string, any>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const fm: Record<string, any> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      fm[key] = val;
    }
  }
  return { frontmatter: fm, body: match[2]! };
}

interface ObjectReadmeViewProps {
  objectName: string;
  /** 可选：是否显示 Hero Title（Chat 页面用） */
  showHero?: boolean;
}

export function ObjectReadmeView({ objectName, showHero = false }: ObjectReadmeViewProps) {
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [traitDetails, setTraitDetails] = useState<TraitInfo[]>([]);
  const [selectedTrait, setSelectedTrait] = useState<TraitInfo | null>(null);

  /* 加载 readme + traits */
  useEffect(() => {
    setLoading(true);
    setReadme(null);
    setTraitDetails([]);
    Promise.all([
      fetchReadme(objectName).catch(() => null),
      fetchTraits(objectName).catch(() => ({ traits: [], kernelTraits: [] })),
    ]).then(([readmeContent, traitsData]) => {
      setReadme(readmeContent);
      setTraitDetails([...traitsData.kernelTraits, ...traitsData.traits]);
    }).finally(() => setLoading(false));
  }, [objectName]);

  const parsed = useMemo(() => readme ? parseFrontmatter(readme) : null, [readme]);
  const publicMethods = parsed?.frontmatter.functions ?? [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-xs text-[var(--muted-foreground)] animate-gentle-pulse">Loading...</span>
      </div>
    );
  }

  return (
    <>
      {/* Hero Title */}
      {showHero && (
        <div className="px-6 pt-8 pb-4">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl italic font-bold" style={{ fontFamily: "Georgia, serif", color: "#215db0" }}>i'm</span>
            <h1 className="text-6xl font-bold">{objectName}</h1>
          </div>
          {parsed?.frontmatter.whoAmI && (
            <p className="text-sm text-[var(--muted-foreground)] mt-2">
              {parsed.frontmatter.whoAmI}
            </p>
          )}
        </div>
      )}

      {/* 两栏布局：左 Readme（可滚动） / 右 Traits + Methods（独立滚动） */}
      <div className="flex gap-6 px-6 pb-6 min-h-0" style={{ height: "calc(100% - 120px)" }}>
        {/* 左栏：Readme（独立滚动） */}
        <div className="flex-1 min-w-0 overflow-auto">
          {readme ? (
            <MarkdownContent content={parsed!.body} className="text-sm leading-relaxed" />
          ) : (
            <div className="py-12">
              <p className="text-sm text-[var(--muted-foreground)]">No readme available</p>
              <p className="text-xs text-[var(--muted-foreground)] opacity-60 mt-1">
                This object doesn't have a readme.md file yet
              </p>
            </div>
          )}
        </div>

        {/* 右栏：个人名片（固定） + Traits 列表（滚动） */}
          <div className="w-72 shrink-0 flex flex-col">
            {/* Object 个人名片（固定不滚动） */}
              <div className="rounded-xl overflow-hidden border border-[var(--border)] shrink-0">
                {/* 背景图 */}
                <div className="h-20 overflow-hidden relative">
                  <div className="absolute inset-0 [&_svg]:block [&_svg]:w-full [&_svg]:h-auto [&_svg]:min-h-full">
                    <Avatar name={objectName + "-bg"} variant="marble" size={288} square colors={["#92A1C6", "#146A7C", "#F0AB3D", "#C271B4", "#C20D90"]} />
                  </div>
                </div>
                {/* 头像 + 信息 */}
                <div className="relative px-4 pb-4">
                  <div className="-mt-6 mb-2">
                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[var(--background)] shadow-sm">
                      <Avatar name={objectName} variant="beam" size={48} colors={["#92A1C6", "#146A7C", "#F0AB3D", "#C271B4", "#C20D90"]} />
                    </div>
                  </div>
                  <h3 className="text-sm font-semibold">{objectName}</h3>
                  {parsed?.frontmatter.whoAmI && (
                    <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 leading-relaxed">
                      {parsed.frontmatter.whoAmI}
                    </p>
                  )}
                </div>
              </div>
            {/* Traits + Methods（独立滚动） */}
            <div className="flex-1 overflow-auto mt-5">
              <div className="space-y-5">
              {/* Traits 列表 */}
              {traitDetails.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2">
                    Traits ({traitDetails.length})
                  </h3>
                  <div className="space-y-0.5">
                    {traitDetails.map((t) => (
                      <button
                        key={t.name}
                        onClick={() => setSelectedTrait(t)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--accent)]/30 transition-colors"
                      >
                        <span className="text-xs font-medium text-[var(--foreground)]">{t.name}</span>
                        <span className="text-[10px] text-[var(--muted-foreground)] ml-2">{t.when}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Public Methods */}
              {publicMethods.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2">
                    Public Methods ({publicMethods.length})
                  </h3>
                  <div className="space-y-1">
                    {publicMethods.map((m: any) => (
                      <div key={m.name} className="px-3 py-2 rounded-lg hover:bg-[var(--accent)]/30 transition-colors">
                        <code className="text-xs font-mono font-medium text-[var(--foreground)]">{m.name}</code>
                        {m.description && (
                          <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{m.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
      </div>

      {/* Trait 详情模态窗 */}
      {selectedTrait && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedTrait(null)}>
          <div
            className="bg-[var(--background)] rounded-xl shadow-xl border border-[var(--border)] w-[600px] max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-sm font-semibold">{selectedTrait.name}</h2>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">when: {selectedTrait.when}</p>
              </div>
              <button onClick={() => setSelectedTrait(null)} className="p-1 rounded hover:bg-[var(--muted)] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
              {selectedTrait.methods.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2">Methods</h3>
                  <div className="space-y-1">
                    {selectedTrait.methods.map((m) => (
                      <div key={m.name} className="px-3 py-1.5 rounded bg-[var(--muted)]/50">
                        <code className="text-xs font-mono">{m.name}</code>
                        {m.description && <span className="text-[11px] text-[var(--muted-foreground)] ml-2">{m.description}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <MarkdownContent content={selectedTrait.readme} className="text-sm leading-relaxed" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
