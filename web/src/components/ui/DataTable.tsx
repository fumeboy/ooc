/**
 * DataTable — 通用数据表格组件
 *
 * 支持排序、选择、自定义渲染、响应式布局。
 * 用于任务列表、对象目录、执行历史等结构化数据展示。
 */

import React, { useState, useMemo, useCallback } from "react";
import { cn } from "../../lib/utils";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Square,
  CheckSquare,
  Minus,
} from "lucide-react";

// 列定义
export interface Column<T> {
  /** 列标识 */
  key: string;
  /** 表头显示文本 */
  header: string;
  /** 列宽度 */
  width?: string | number;
  /** 是否可排序 */
  sortable?: boolean;
  /** 自定义渲染函数 */
  render?: (row: T) => React.ReactNode;
  /** 对齐方式 */
  align?: "left" | "center" | "right";
}

// Props
interface DataTableProps<T> {
  /** 列定义 */
  columns: Column<T>[];
  /** 数据行 */
  data: T[];
  /** 行唯一键，可以是字段名或函数 */
  rowKey: keyof T | ((row: T) => string);

  // 排序
  /** 当前排序列 */
  sortKey?: string;
  /** 排序方向 */
  sortDirection?: "asc" | "desc";
  /** 排序回调 */
  onSort?: (key: string, direction: "asc" | "desc") => void;

  // 选择
  /** 是否可选择行 */
  selectable?: boolean;
  /** 已选中的行 key */
  selectedKeys?: string[];
  /** 选择回调 */
  onSelect?: (keys: string[]) => void;

  // 交互
  /** 行点击回调 */
  onRowClick?: (row: T) => void;
  /** 是否悬停高亮，默认 true */
  hoverable?: boolean;

  // 空状态
  /** 空数据时显示文本 */
  emptyText?: string;

  // 样式
  /** 最大高度 */
  maxHeight?: string;
}

export type { DataTableProps };

// 工具函数：获取行 key
function getRowKey<T>(row: T, rowKey: keyof T | ((row: T) => string)): string {
  if (typeof rowKey === "function") {
    return rowKey(row);
  }
  return String(row[rowKey]);
}

// 工具函数：对齐样式
const ALIGN_CLASSES: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

// 表头单元格
interface HeaderCellProps<T> {
  column: Column<T>;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
}

function HeaderCell<T>({
  column,
  sortKey,
  sortDirection,
  onSort,
}: HeaderCellProps<T>) {
  const isSorted = sortKey === column.key;
  const SortIcon = isSorted
    ? sortDirection === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  const handleClick = () => {
    if (column.sortable && onSort) {
      onSort(column.key);
    }
  };

  return (
    <th
      className={cn(
        "px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider",
        ALIGN_CLASSES[column.align || "left"],
        column.sortable && "cursor-pointer hover:bg-[var(--accent)]/50 transition-colors select-none"
      )}
      style={{ width: column.width }}
      onClick={handleClick}
    >
      <div
        className={cn(
          "flex items-center gap-1",
          column.align === "center" && "justify-center",
          column.align === "right" && "justify-end"
        )}
      >
        {column.header}
        {column.sortable && (
          <SortIcon className="w-3 h-3 opacity-60" />
        )}
      </div>
    </th>
  );
}

// 主组件
export function DataTable<T>({
  columns,
  data,
  rowKey,
  // 排序
  sortKey: externalSortKey,
  sortDirection: externalSortDirection,
  onSort,
  // 选择
  selectable = false,
  selectedKeys: externalSelectedKeys,
  onSelect,
  // 交互
  onRowClick,
  hoverable = true,
  // 空状态
  emptyText = "暂无数据",
  // 样式
  maxHeight,
}: DataTableProps<T>) {
  // 内部排序状态（非受控模式）
  const [internalSortKey, setInternalSortKey] = useState<string | undefined>(
    externalSortKey
  );
  const [internalSortDirection, setInternalSortDirection] = useState<
    "asc" | "desc" | undefined
  >(externalSortDirection);

  // 使用外部或内部排序状态
  const sortKey = externalSortKey ?? internalSortKey;
  const sortDirection = externalSortDirection ?? internalSortDirection;

  // 内部选择状态
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<Set<string>>(
    new Set(externalSelectedKeys || [])
  );
  const selectedKeys = externalSelectedKeys
    ? new Set(externalSelectedKeys)
    : internalSelectedKeys;

  // 排序回调
  const handleSort = useCallback(
    (key: string) => {
      let newDirection: "asc" | "desc" | undefined;

      if (sortKey !== key) {
        newDirection = "asc";
      } else if (sortDirection === "asc") {
        newDirection = "desc";
      } else if (sortDirection === "desc") {
        newDirection = undefined; // 取消排序
      } else {
        newDirection = "asc";
      }

      if (onSort) {
        // 受控模式
        if (newDirection) {
          onSort(key, newDirection);
        }
      } else {
        // 非受控模式
        setInternalSortKey(newDirection ? key : undefined);
        setInternalSortDirection(newDirection);
      }
    },
    [sortKey, sortDirection, onSort]
  );

  // 选择回调
  const handleSelectRow = useCallback(
    (key: string) => {
      const newSelected = new Set(selectedKeys);
      if (newSelected.has(key)) {
        newSelected.delete(key);
      } else {
        newSelected.add(key);
      }

      if (onSelect) {
        onSelect(Array.from(newSelected));
      } else {
        setInternalSelectedKeys(newSelected);
      }
    },
    [selectedKeys, onSelect]
  );

  // 全选
  const handleSelectAll = useCallback(() => {
    const allKeys = data.map((row) => getRowKey(row, rowKey));
    const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys.has(k));

    const newSelected = allSelected ? new Set<string>() : new Set(allKeys);

    if (onSelect) {
      onSelect(Array.from(newSelected));
    } else {
      setInternalSelectedKeys(newSelected);
    }
  }, [data, rowKey, selectedKeys, onSelect]);

  // 同步外部 selectedKeys 到内部状态
  React.useEffect(() => {
    if (externalSelectedKeys !== undefined) {
      setInternalSelectedKeys(new Set(externalSelectedKeys));
    }
  }, [externalSelectedKeys]);

  // 同步外部排序状态到内部
  React.useEffect(() => {
    if (externalSortKey !== undefined) {
      setInternalSortKey(externalSortKey);
    }
    if (externalSortDirection !== undefined) {
      setInternalSortDirection(externalSortDirection);
    }
  }, [externalSortKey, externalSortDirection]);

  // 排序后的数据（非受控模式）
  const sortedData = useMemo(() => {
    if (!sortKey || !sortDirection) return data;

    return [...data].sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];

      let comparison = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal ?? "").localeCompare(String(bVal ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [data, sortKey, sortDirection]);

  // 全选状态
  const allKeys = data.map((row) => getRowKey(row, rowKey));
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys.has(k));
  const someSelected = allKeys.some((k) => selectedKeys.has(k)) && !allSelected;

  const containerStyle: React.CSSProperties = {
    maxHeight,
    overflow: maxHeight ? "auto" : undefined,
  };

  return (
    <div
      className="border border-[var(--border)] rounded-lg bg-[var(--background)] overflow-hidden"
      style={containerStyle}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[var(--muted)]/30 border-b border-[var(--border)] sticky top-0">
            <tr>
              {selectable && (
                <th className="px-4 py-3 w-10">
                  <button
                    onClick={handleSelectAll}
                    className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : someSelected ? (
                      <Minus className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
              )}
              {columns.map((column) => (
                <HeaderCell
                  key={column.key}
                  column={column}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={column.sortable ? handleSort : undefined}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sortedData.length === 0 ? (
              <tr>
                <td
                  colSpan={selectable ? columns.length + 1 : columns.length}
                  className="py-12 text-center text-[var(--muted-foreground)] text-sm"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              sortedData.map((row) => {
                const key = getRowKey(row, rowKey);
                const isSelected = selectedKeys.has(key);

                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      "transition-colors",
                      hoverable && "hover:bg-[var(--accent)]/30",
                      onRowClick && "cursor-pointer",
                      isSelected && "bg-[var(--accent)]/50"
                    )}
                  >
                    {selectable && (
                      <td className="px-4 py-3 w-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectRow(key);
                          }}
                          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    )}
                    {columns.map((column) => {
                      const value = (row as any)[column.key];
                      const content = column.render
                        ? column.render(row)
                        : value;

                      return (
                        <td
                          key={column.key}
                          className={cn(
                            "px-4 py-3",
                            ALIGN_CLASSES[column.align || "left"]
                          )}
                          style={{ width: column.width }}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
