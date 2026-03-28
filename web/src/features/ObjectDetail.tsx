/**
 * ObjectDetail —— 对象详情页（Readme/Data/Effects/UI 标签页）
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
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { cn } from "../lib/utils";
import { objectUIs, hasCustomUI } from "../objects";
import type { StoneData } from "../api/types";

const BASE_TABS = ["Readme", "Data", "Effects"] as const;
type Tab = (typeof BASE_TABS)[number] | "Memory" | "UI";

interface ObjectDetailProps {
  objectName: string;
  initialTab?: string;
}

export function ObjectDetail({ objectName, initialTab }: ObjectDetailProps) {
  /* 有自定义 UI 时默认展示 UI Tab */
  const defaultTab: Tab = hasCustomUI(objectName) ? "UI" : "Readme";
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || defaultTab);
  const [stone, setStone] = useState<StoneData | null>(null);

  const tabs = useMemo<Tab[]>(() => {
    const t: Tab[] = [...BASE_TABS];
    if (stone?.memory) t.push("Memory");
    if (hasCustomUI(objectName)) t.push("UI");
    return t;
  }, [objectName, stone?.memory]);

  useEffect(() => {
    setStone(null);
    /* 有自定义 UI 时默认展示 UI Tab */
    const resetDefault: Tab = hasCustomUI(objectName) ? "UI" : "Readme";
    setTab((initialTab as Tab) || resetDefault);
    fetchObject(objectName).then(setStone).catch(console.error);
  }, [objectName, initialTab]);

  if (!stone) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--muted-foreground)] text-sm">
        加载中...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部：左侧信息 + 右侧 Tabs 同行 */}
      <div className="flex items-center justify-between px-4 sm:px-8 py-2 gap-4 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <ObjectAvatar name={stone.name} size="md" />
          <h2 className="text-lg sm:text-xl font-bold leading-none truncate" style={{ fontFamily: "var(--heading-font)" }}>
            {stone.name}
          </h2>
        </div>

        {/* Tab 按钮组 */}
        <div className="flex items-center bg-[var(--accent)] rounded-lg p-0.5 overflow-x-auto scrollbar-hide">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition-all whitespace-nowrap",
                tab === t
                  ? "bg-[var(--card)] text-[var(--foreground)] font-medium shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-4 sm:py-6">
        {tab === "Readme" && <ObjectReadmeView objectName={objectName} />}
        {tab === "Data" && <DataTab data={stone.data} />}
        {tab === "Effects" && <EffectsTab objectName={objectName} />}
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
