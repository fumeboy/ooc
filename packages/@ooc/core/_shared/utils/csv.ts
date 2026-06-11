/**
 * csv 编解码纯函数 —— canonical 源（从 `persistable/csv-pool.ts` 迁入）。
 *
 * RFC 4180 子集：字段含 `,` / `"` / `\n` / `\r` 时整字段用 `"` 包裹，内部 `"` → `""`。
 * 选择手写而非依赖第三方库：OOC csv 是标准格式（无嵌套表），避免 supply chain 风险，
 * 实现 < 100 行覆盖标准转义足够。
 *
 * 仅含纯编解码；带 IO 的读写函数（readCsv / writeCsv / appendRow / atomicWriteFile）
 * 留在 `persistable/csv-pool.ts`。
 */

/**
 * 把一行字段数组序列化为 csv 行（不含末尾换行）。
 *
 * 转义规则：字段含 `,` / `"` / `\n` / `\r` 时整字段用 `"` 包裹，内部 `"` → `""`。
 *
 * （原 `csv-pool.ts` 内部的 `stringifyRow`，迁移时改名为 public 的 `stringifyCsvRow`。）
 */
export function stringifyCsvRow(fields: string[]): string {
  return fields
    .map((f) => {
      if (/[",\n\r]/.test(f)) {
        return `"${f.replace(/"/g, '""')}"`;
      }
      return f;
    })
    .join(",");
}

/**
 * 解析 csv 文本为字段二维数组。
 *
 * 支持 CRLF / LF 换行；忽略文件末尾的可选换行；空文件返回 `[]`。
 * 不支持注释行、不支持自定义分隔符（OOC 约定就是 `,`）。
 *
 * 解析失败时抛错（含位置 hint），便于调用方在错误信息里再注明文件名。
 */
export function parseCsv(text: string): string[][] {
  if (text.length === 0) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      // 仅在字段开头允许进入引号模式；否则当作普通字符（宽容）
      if (field.length === 0) {
        inQuotes = true;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      // CRLF: 跳过 \n
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += i + 1 < n && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (inQuotes) {
    throw new Error(`csv parse error: unterminated quoted field`);
  }
  // 末尾未换行的最后一行：若有任何累积内容则收尾
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
