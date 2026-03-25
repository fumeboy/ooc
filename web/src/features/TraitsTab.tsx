/**
 * TraitsTab —— 对象 Trait 列表展示
 *
 * @ref .ooc/docs/哲学文档/gene.md#G3 — renders — Trait 定义（when, readme, methods）
 * @ref .ooc/docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 */
import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { fetchTraits } from "../api/client";
import { CodeBlock } from "../components/ui/CodeBlock";
import type { TraitInfo } from "../api/types";

interface TraitsTabProps {
  objectName: string;
}

export function TraitsTab({ objectName }: TraitsTabProps) {
  const [data, setData] = useState<{ traits: TraitInfo[]; kernelTraits: TraitInfo[] } | null>(null);

  useEffect(() => {
    setData(null);
    fetchTraits(objectName).then(setData).catch(console.error);
  }, [objectName]);

  if (!data) {
    return <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>;
  }

  return (
    <div className="space-y-6">
      {data.traits.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-[var(--muted-foreground)] mb-2">
            Object Traits
          </h3>
          <div className="space-y-1">
            {data.traits.map((t) => (
              <TraitItem key={t.name} trait={t} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium text-[var(--muted-foreground)] mb-2">
          Kernel Traits
        </h3>
        <div className="space-y-1">
          {data.kernelTraits.map((t) => (
            <TraitItem key={t.name} trait={t} />
          ))}
        </div>
      </section>
    </div>
  );
}

function TraitItem({ trait }: { trait: TraitInfo }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-[var(--accent)] transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
        )}
        <span className="text-sm font-mono">{trait.name}</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
          {trait.when}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 border-t border-[var(--border)]">
          {trait.readme && (
            <CodeBlock muted className="mt-2" maxHeight="max-h-60">{trait.readme}</CodeBlock>
          )}
          {trait.methods.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium mb-1">方法:</p>
              <ul className="space-y-0.5">
                {trait.methods.map((m) => (
                  <li key={m.name} className="text-xs font-mono">
                    {m.name}
                    {m.description && (
                      <span className="text-[var(--muted-foreground)] ml-2">
                        — {m.description}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
