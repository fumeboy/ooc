/**
 * RelationList — 对象关系列表组件
 *
 * 展示对象的社交关系、依赖连接等。
 * 简化版，替代复杂的 RelationGraph。
 */

import React, { useMemo } from "react";
import { cn } from "../../lib/utils";
import { ObjectAvatar } from "./ObjectAvatar";
import { Badge } from "./Badge";
import { ArrowRight, Users } from "lucide-react";

// 类型定义
export type RelationType =
  | "friend"
  | "child"
  | "parent"
  | "collaborator"
  | "custom";

export interface Relation {
  /** 目标对象名 */
  target: string;
  /** 关系类型 */
  type: RelationType;
  /** 自定义标签（可选） */
  label?: string;
  /** 关系描述 */
  description?: string;
}

interface RelationListProps {
  /** 关系列表 */
  relations: Relation[];
  /** 当前对象名（用于视角） */
  objectName: string;
  /** 关系点击回调 */
  onRelationClick?: (rel: Relation) => void;
  /** 跳转到目标对象 */
  onNavigate?: (targetName: string) => void;
  /** 按类型过滤 */
  filterType?: RelationType;
  /** 空状态文本 */
  emptyText?: string;
  /** 是否显示类型标签 */
  showTypeLabels?: boolean;
  /** 最大高度 */
  maxHeight?: string;
}

export type { RelationListProps };

// 关系类型配置
const RELATION_CONFIG: Record<
  RelationType,
  { color: string; label: string; variant: "green" | "blue" | "purple" | "orange" | "gray" }
> = {
  friend: {
    color: "text-green-600 dark:text-green-400",
    label: "好友",
    variant: "green",
  },
  child: {
    color: "text-blue-600 dark:text-blue-400",
    label: "子对象",
    variant: "blue",
  },
  parent: {
    color: "text-purple-600 dark:text-purple-400",
    label: "父对象",
    variant: "purple",
  },
  collaborator: {
    color: "text-orange-600 dark:text-orange-400",
    label: "协作者",
    variant: "orange",
  },
  custom: {
    color: "text-gray-600 dark:text-gray-400",
    label: "自定义",
    variant: "gray",
  },
};

/**
 * 单个关系项
 */
interface RelationItemProps {
  relation: Relation;
  objectName: string;
  showTypeLabels: boolean;
  onRelationClick?: (rel: Relation) => void;
  onNavigate?: (targetName: string) => void;
}

function RelationItem({
  relation,
  objectName,
  showTypeLabels,
  onRelationClick,
  onNavigate,
}: RelationItemProps) {
  const { target, type, label, description } = relation;
  const config = RELATION_CONFIG[type];
  const displayLabel = label || config.label;

  const handleClick = () => {
    onRelationClick?.(relation);
    onNavigate?.(target);
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-3 py-2 transition-colors",
        (onRelationClick || onNavigate) && "cursor-pointer hover:bg-[var(--accent)]/60"
      )}
      onClick={handleClick}
    >
      {/* 关系方向图标 */}
      <div className="flex flex-col items-center pt-1">
        <ObjectAvatar name={objectName} size="sm" />
        <ArrowRight className={cn("w-3 h-3 my-1", config.color)} />
        <ObjectAvatar name={target} size="sm" />
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">
            {objectName}
          </span>
          <ArrowRight className={cn("w-3 h-3 shrink-0", config.color)} />
          <span
            className={cn(
              "text-xs font-medium text-[var(--foreground)] truncate",
              onNavigate && "hover:underline"
            )}
          >
            {target}
          </span>
          {showTypeLabels && (
            <Badge variant={config.variant} mono className="text-[10px] shrink-0">
              {displayLabel}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1 truncate">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function RelationList({
  relations,
  objectName,
  onRelationClick,
  onNavigate,
  filterType,
  emptyText = "暂无关系",
  showTypeLabels = true,
  maxHeight,
}: RelationListProps) {
  // 按类型过滤
  const filteredRelations = useMemo(() => {
    if (!filterType) return relations;
    return relations.filter((r) => r.type === filterType);
  }, [relations, filterType]);

  const containerStyle: React.CSSProperties = {
    maxHeight,
    overflow: maxHeight ? "auto" : undefined,
  };

  // 空状态
  if (filteredRelations.length === 0) {
    return (
      <div className="border border-[var(--border)] rounded-lg bg-[var(--background)]">
        <div className="py-8 text-center">
          <Users className="w-8 h-8 mx-auto text-[var(--muted-foreground)] mb-2 opacity-50" />
          <p className="text-sm text-[var(--muted-foreground)]">{emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="border border-[var(--border)] rounded-lg bg-[var(--background)] overflow-hidden"
      style={containerStyle}
    >
      <div className="py-1">
        {filteredRelations.map((relation, index) => (
          <RelationItem
            key={`${relation.target}-${index}`}
            relation={relation}
            objectName={objectName}
            showTypeLabels={showTypeLabels}
            onRelationClick={onRelationClick}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}
