/**
 * IdentityTab —— 对象身份信息展示（talkable + thinkable）
 *
 * @ref .ooc/docs/哲学文档/gene.md#G1 — renders — 对象的 thinkable.whoAmI 和 talkable 信息
 * @ref .ooc/docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 * @ref src/types/object.ts — references — StoneData 类型
 */
import type { StoneData } from "../api/types";

interface IdentityTabProps {
  stone: StoneData;
}

export function IdentityTab({ stone }: IdentityTabProps) {
  return (
    <div className="space-y-8">
      {/* Talkable */}
      <section>
        <h3 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
          对外介绍 (talkable)
        </h3>
        <p className="text-sm leading-relaxed">{stone.talkable.whoAmI || "(未设置)"}</p>
        {stone.talkable.functions.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-[var(--muted-foreground)] mb-2">公开方法</p>
            <div className="space-y-1.5">
              {stone.talkable.functions.map((fn) => (
                <div key={fn.name} className="text-sm font-mono bg-[var(--muted)] rounded px-3 py-1.5">
                  {fn.name}
                  {fn.description && (
                    <span className="text-[var(--muted-foreground)] font-sans ml-2">
                      — {fn.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Thinkable */}
      <section>
        <h3 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
          自我认知 (thinkable)
        </h3>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">
          {stone.thinkable.whoAmI || "(未设置)"}
        </p>
      </section>

      {/* Relations */}
      <section>
        <h3 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
          关系 (relations)
        </h3>
        {stone.relations.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">(暂无)</p>
        ) : (
          <div className="space-y-1.5">
            {stone.relations.map((rel) => (
              <div key={rel.name} className="text-sm">
                <span className="font-mono bg-[var(--muted)] rounded px-1.5 py-0.5">{rel.name}</span>
                <span className="text-[var(--muted-foreground)] ml-2">
                  {rel.description}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
