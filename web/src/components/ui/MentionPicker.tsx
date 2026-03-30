/**
 * MentionPicker — @ 对象选择器组件
 *
 * 用于消息输入框中 @ 提及对象。
 * 支持搜索过滤、键盘导航、选中高亮。
 */

import React, { useMemo } from "react";
import { cn } from "../../lib/utils";
import { ObjectAvatar } from "./ObjectAvatar";
import { Badge } from "./Badge";

// 类型定义
export interface ObjectOption {
  /** 对象名 */
  name: string;
  /** 简短描述 */
  description?: string;
  /** 用于分类筛选的 traits */
  traits?: string[];
  /** 头像颜色（可选，不填自动生成） */
  color?: string;
}

interface MentionPickerProps {
  /** 可选对象列表 */
  objects: ObjectOption[];
  /** 当前搜索词 */
  searchQuery: string;
  /** 搜索回调 */
  onSearch: (query: string) => void;
  /** 选择回调 */
  onSelect: (obj: ObjectOption) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 是否显示 */
  isOpen: boolean;
  /** 定位坐标（相对于输入框光标） */
  position?: { x: number; y: number };
  /** 最大显示条数，默认 8 */
  maxItems?: number;
  /** 已选中的对象名（高亮） */
  selectedNames?: string[];
  /** 是否禁用 */
  disabled?: boolean;
}

export type { MentionPickerProps };

/**
 * 过滤对象列表
 * 匹配 name、description 和 traits，按优先级排序
 */
function filterObjects(
  objects: ObjectOption[],
  query: string,
  maxItems: number
): ObjectOption[] {
  if (!query.trim()) {
    return objects.slice(0, maxItems);
  }

  const lowerQuery = query.toLowerCase().trim();

  return objects
    .filter((obj) => {
      const nameMatch = obj.name.toLowerCase().includes(lowerQuery);
      const descMatch = obj.description?.toLowerCase().includes(lowerQuery) || false;
      const traitMatch =
        obj.traits?.some((t) => t.toLowerCase().includes(lowerQuery)) || false;
      return nameMatch || descMatch || traitMatch;
    })
    .sort((a, b) => {
      // 按匹配优先级排序：name 开头匹配 > name 包含 > description > traits
      const aNameStartsWith = a.name.toLowerCase().startsWith(lowerQuery);
      const bNameStartsWith = b.name.toLowerCase().startsWith(lowerQuery);
      if (aNameStartsWith !== bNameStartsWith) return aNameStartsWith ? -1 : 1;

      const aNameMatch = a.name.toLowerCase().includes(lowerQuery);
      const bNameMatch = b.name.toLowerCase().includes(lowerQuery);
      if (aNameMatch !== bNameMatch) return aNameMatch ? -1 : 1;

      return 0;
    })
    .slice(0, maxItems);
}

/**
 * 单个对象选项
 */
interface ObjectOptionItemProps {
  obj: ObjectOption;
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: () => void;
}

function ObjectOptionItem({
  obj,
  isSelected,
  isHighlighted,
  onClick,
}: ObjectOptionItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
        isHighlighted
          ? "bg-[var(--accent)]"
          : "hover:bg-[var(--accent)]/60",
        isSelected && "ring-2 ring-[var(--foreground)]/20"
      )}
    >
      <ObjectAvatar name={obj.name} size="md" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--foreground)] truncate">
            @{obj.name}
          </span>
          {isSelected && (
            <Badge variant="green" mono className="text-[10px]">
              已选
            </Badge>
          )}
        </div>
        {obj.description && (
          <p className="text-[10px] text-[var(--muted-foreground)] truncate mt-0.5">
            {obj.description}
          </p>
        )}
        {obj.traits && obj.traits.length > 0 && (
          <div className="flex items-center gap-1 mt-1">
            {obj.traits.slice(0, 3).map((trait) => (
              <Badge key={trait} variant="gray" mono className="text-[9px]">
                {trait}
              </Badge>
            ))}
            {obj.traits.length > 3 && (
              <span className="text-[9px] text-[var(--muted-foreground)]">
                +{obj.traits.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

export function MentionPicker({
  objects,
  searchQuery,
  onSearch: _onSearch,
  onSelect,
  onClose: _onClose,
  isOpen,
  position,
  maxItems = 8,
  selectedNames = [],
  disabled = false,
}: MentionPickerProps) {
  const filteredObjects = useMemo(
    () => filterObjects(objects, searchQuery, maxItems),
    [objects, searchQuery, maxItems]
  );

  const selectedSet = useMemo(
    () => new Set(selectedNames),
    [selectedNames]
  );

  // 空状态或关闭
  if (!isOpen || disabled) {
    return null;
  }

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    left: position?.x ?? 0,
    top: position?.y ?? 0,
    zIndex: 50,
  };

  return (
    <div
      style={containerStyle}
      className="mention-picker w-72 max-h-64 overflow-auto bg-[var(--popover)] border border-[var(--border)] rounded-lg shadow-xl"
    >
      {filteredObjects.length === 0 ? (
        <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">
          未找到匹配的对象
        </div>
      ) : (
        <div className="py-1">
          {filteredObjects.map((obj) => (
            <ObjectOptionItem
              key={obj.name}
              obj={obj}
              isSelected={selectedSet.has(obj.name)}
              isHighlighted={false}
              onClick={() => {
                onSelect(obj);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
