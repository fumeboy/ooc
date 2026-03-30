/**
 * KeyValuePanel — 简洁的键值对面板组件
 *
 * 用于展示扁平数据、对象状态概览、配置项。
 * 比 JsonTreeViewer 更轻量、更易读。
 */

import React, { useState } from "react";
import { cn } from "../../lib/utils";
import { Badge } from "./Badge";
import { ChevronRight, ChevronDown } from "lucide-react";

export interface KeyValueItem {
  /** 键名 */
  key: string;
  /** 值 */
  value: React.ReactNode;
  /** 显示名称（可选，不填用 key） */
  label?: string;
  /** 值类型，用于格式化显示 */
  type?: "string" | "number" | "boolean" | "date" | "array";
}

interface KeyValuePanelProps {
  /** 键值对列表 */
  items: KeyValueItem[];
  /** 布局模式：grid（网格多列）或 list（列表单列） */
  layout?: "grid" | "list";
  /** Grid 模式的列数，默认 2 */
  columns?: number;
  /** 面板标题 */
  title?: string;
  /** 是否可折叠 */
  collapsible?: boolean;
  /** 默认是否折叠 */
  defaultCollapsed?: boolean;
  /** 最大高度 */
  maxHeight?: string;
  /** 空状态文本 */
  emptyText?: string;
}

export type { KeyValuePanelProps };

/**
 * 根据类型格式化值
 */
function formatValue(
  value: React.ReactNode,
  type?: KeyValueItem["type"]
): React.ReactNode {
  if (type === "boolean") {
    const boolValue = value === true || value === "true";
    return (
      <Badge variant={boolValue ? "green" : "red"}>
        {boolValue ? "true" : "false"}
      </Badge>
    );
  }
  if (type === "date") {
    if (value instanceof Date) {
      return (
        <span className="font-mono text-xs">{value.toLocaleString()}</span>
      );
    }
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return (
          <span className="font-mono text-xs">{date.toLocaleString()}</span>
        );
      }
    }
  }
  if (type === "number" && typeof value === "number") {
    return (
      <span className="text-right font-mono">{value.toLocaleString()}</span>
    );
  }
  if (type === "array") {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return (
          <span className="text-[var(--muted-foreground)]">[]</span>
        );
      }
      return (
        <span className="text-xs">
          <span className="text-[var(--muted-foreground)]">[</span>
          <span className="text-[var(--muted-foreground)]">
            {value.length} items
          </span>
          <span className="text-[var(--muted-foreground)]">]</span>
        </span>
      );
    }
  }
  return value;
}

/**
 * 单个键值对项
 */
interface KeyValueItemRowProps {
  item: KeyValueItem;
  layout: "grid" | "list";
}

function KeyValueItemRow({ item, layout }: KeyValueItemRowProps) {
  const { key, value, label, type } = item;
  const displayLabel = label || key;
  const formattedValue = formatValue(value, type);

  if (layout === "list") {
    return (
      <div className="flex items-start justify-between py-2 border-b border-[var(--border)] last:border-b-0">
        <div className="text-xs text-[var(--muted-foreground)] shrink-0 mr-4">
          {displayLabel}
        </div>
        <div className="text-xs text-[var(--foreground)] text-right flex-shrink-0">
          {formattedValue}
        </div>
      </div>
    );
  }

  // Grid 布局
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-2">
      <div className="text-xs text-[var(--muted-foreground)] shrink-0 sm:w-1/3">
        {displayLabel}
      </div>
      <div className="text-xs text-[var(--foreground)]">{formattedValue}</div>
    </div>
  );
}

export function KeyValuePanel({
  items,
  layout = "grid",
  columns = 2,
  title,
  collapsible = false,
  defaultCollapsed = false,
  maxHeight,
  emptyText = "暂无数据",
}: KeyValuePanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Grid 列数映射
  const gridColsClass: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  };

  // 处理 columns 超出范围的情况，默认使用 2 列
  const safeColumns = columns >= 1 && columns <= 4 ? columns : 2;
  const colsClass = gridColsClass[safeColumns];

  const containerStyle: React.CSSProperties = {
    maxHeight,
    overflow: maxHeight ? "auto" : undefined,
  };

  // 空状态
  if (items.length === 0) {
    return (
      <div className="border border-[var(--border)] rounded-lg bg-[var(--background)]">
        {title && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30">
            <span className="text-sm font-medium text-[var(--foreground)]">
              {title}
            </span>
          </div>
        )}
        <div className="py-8 text-center text-[var(--muted-foreground)] text-sm">
          {emptyText}
        </div>
      </div>
    );
  }

  const handleTitleClick = () => {
    if (collapsible) {
      setCollapsed(!collapsed);
    }
  };

  return (
    <div
      className="border border-[var(--border)] rounded-lg bg-[var(--background)]"
      style={containerStyle}
    >
      {/* 标题栏 */}
      {title && (
        <button
          type="button"
          onClick={handleTitleClick}
          disabled={!collapsible}
          className={cn(
            "w-full flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30",
            collapsible && "hover:bg-[var(--muted)]/50 transition-colors cursor-pointer",
            !collapsible && "cursor-default"
          )}
        >
          {collapsible &&
            (collapsed ? (
              <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[var(--muted-foreground)]" />
            ))}
          <span className="text-sm font-medium text-[var(--foreground)]">
            {title}
          </span>
        </button>
      )}

      {/* 内容区 */}
      {!collapsed && (
        <div className="px-4 py-3">
          {layout === "grid" ? (
            <div className={cn("grid gap-x-6 gap-y-1", colsClass)}>
              {items.map((item) => (
                <KeyValueItemRow
                  key={item.key}
                  item={item}
                  layout={layout}
                />
              ))}
            </div>
          ) : (
            <div>
              {items.map((item) => (
                <KeyValueItemRow
                  key={item.key}
                  item={item}
                  layout={layout}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
