/**
 * CsvTableView —— CSV / TSV 文件表格预览。
 *
 * 行为：
 * - 解析逻辑：自己写一个最小 quote-aware parser（处理 `"..."` 包裹的 cell 与内部
 *   `""` 转义）。不依赖第三方 csv lib，保持 visibility-first 路径无新增依赖。
 * - 第一行作 sticky header；超过 200 行默认折叠尾部，显示 "Show all X rows" 按钮。
 * - 支持 BOM 剥离。
 * - TSV 通过 `delimiter="\t"` 传入。
 */
import { useMemo, useState } from "react";

interface CsvTableViewProps {
  /** 原始文件内容（已经被 fetch）。 */
  content: string;
  /** 分隔符，默认 ","。 */
  delimiter?: string;
  /** 默认显示行数（不含 header），超过则折叠。 */
  defaultRowLimit?: number;
}

export function CsvTableView({
  content,
  delimiter = ",",
  defaultRowLimit = 200,
}: CsvTableViewProps) {
  const rows = useMemo(() => parseCsv(content, delimiter), [content, delimiter]);
  const [showAll, setShowAll] = useState(false);

  if (rows.length === 0) {
    return <div className="muted small csv-table-empty">(empty CSV)</div>;
  }

  const header = rows[0]!;
  const body = rows.slice(1);
  const visibleBody = showAll ? body : body.slice(0, defaultRowLimit);
  const hiddenCount = body.length - visibleBody.length;

  return (
    <div className="csv-table-wrap">
      <table className="csv-table">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} title={cell}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleBody.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} title={cell}>
                  {cell}
                </td>
              ))}
              {/* pad short rows so columns align */}
              {row.length < header.length &&
                Array.from({ length: header.length - row.length }).map((_, k) => (
                  <td key={`pad-${k}`} />
                ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="csv-table-footer">
        <span className="muted small">
          {body.length} row{body.length === 1 ? "" : "s"} · {header.length} column
          {header.length === 1 ? "" : "s"}
        </span>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="btn small"
            onClick={() => setShowAll(true)}
          >
            Show all {body.length} rows ({hiddenCount} hidden)
          </button>
        )}
        {showAll && body.length > defaultRowLimit && (
          <button
            type="button"
            className="btn small"
            onClick={() => setShowAll(false)}
          >
            Collapse
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 最小 quote-aware CSV / TSV 解析器。
 *
 * 支持：
 * - "..." quoted field（包裹空白、换行、分隔符）
 * - "" 转义为 cell 内的单个 "
 * - \r\n / \n / \r 行分隔
 * - 头部 BOM 剥离
 *
 * 不支持（明确）：
 * - 多字符分隔符
 * - 自定义 quote char（始终 `"`）
 */
export function parseCsv(input: string, delimiter: string): string[][] {
  // BOM strip
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // escaped quote
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      cur.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      cur.push(cell);
      rows.push(cur);
      cur = [];
      cell = "";
      // consume \r\n as a single newline
      if (ch === "\r" && text[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  // tail
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell);
    rows.push(cur);
  }
  // strip trailing empty row caused by trailing newline
  if (rows.length > 0 && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === "") {
    rows.pop();
  }
  return rows;
}
