/**
 * ObjectDetail —— 对象详情页（Readme/Data/Effects/Shared/UI 标签页）
 *
 * @ref docs/哲学文档/gene.md#G1 — renders — 对象的完整组成（thinkable, talkable, data, traits, effects）
 * @ref docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达（含自定义 UI 标签页）
 * @ref src/types/object.ts — references — StoneData 类型
 */
import { useState, useEffect, useMemo } from "react";
import { fetchObject } from "../api/client";
import { ObjectReadmeView } from "./ObjectReadmeView";
import { DataTab } from "./DataTab";
import { EffectsTab } from "./EffectsTab";
import { SharedTab } from "./SharedTab";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { cn } from "../lib/utils";
import { objectUIs, hasCustomUI } from "../objects";
import type { StoneData } from "../api/types";

const BASE_TABS = ["Readme", "Data", "Effects", "Shared"] as const;
type Tab = (typeof BASE_TABS)[number] | "Memory" | "UI";

interface ObjectDetailProps {
  objectName: string;
}

export function ObjectDetail({ objectName }: ObjectDetailProps) {
  const [tab, setTab] = useState<Tab>("Readme");
  const [stone, setStone] = useState<StoneData | null>(null);

  const tabs = useMemo<Tab[]>(() => {
    const t: Tab[] = [...BASE_TABS];
    if (stone?.memory) t.push("Memory");
    if (hasCustomUI(objectName)) t.push("UI");
    return t;
  }, [objectName, stone?.memory]);

  useEffect(() => {
    setStone(null);
    setTab("Readme");
    fetchObject(objectName).then(setStone).catch(console.error);
  }, [objectName]);

  if (!stone) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--muted-foreground)] text-sm">
        加载中...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 sm:px-8 pt-6 sm:pt-10 pb-0">
        <h2
          className="text-2xl sm:text-3xl font-bold"
          style={{ fontFamily: "var(--heading-font)" }}
        >
          {stone.name}
        </h2>
        {stone.talkable.whoAmI && (
          <p className="text-[var(--muted-foreground)] mt-1 text-sm sm:text-base">
            {stone.talkable.whoAmI}
          </p>
        )}
        {/* Tab 栏 — underline style, 移动端可横向滚动 */}
        <div className="flex gap-0 mt-4 sm:mt-6 border-b border-[var(--border)] overflow-x-auto scrollbar-hide">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 pb-2 text-sm transition-colors relative whitespace-nowrap",
                tab === t
                  ? "text-[var(--foreground)] font-medium"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t}
              {tab === t && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--foreground)] rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-4 sm:py-6">
        {tab === "Readme" && <ObjectReadmeView objectName={objectName} />}
        {tab === "Data" && <DataTab data={stone.data} />}
        {tab === "Effects" && <EffectsTab objectName={objectName} />}
        {tab === "Shared" && <SharedTab objectName={objectName} />}
        {tab === "Memory" && stone.memory && (
          <div className="prose prose-sm max-w-none">
            <MarkdownContent content={stone.memory} />
          </div>
        )}
        {tab === "UI" && objectUIs[objectName] &&
          (() => { const CustomUI = objectUIs[objectName]; return <CustomUI objectName={objectName} stone={stone} />; })()
        }
      </div>
    </div>
  );
}
