/**
 * csv-based pool data —— Object 跨 session 累积的事实数据（一张表 = 一个 csv）。
 *
 * 约定（详见 meta/object.doc.ts persistable.pool.children.data_pool 节点）：
 * - 路径形态：`{baseDir}/pools/objects/{objectId}/data/{name}.csv`
 * - 首行为 header；值都是 string（数字 / 布尔由调用方自己 parse / format）
 * - csv 名 kebab-case（详见 pool-object.poolDataFile 的 CSV_NAME_RE）
 * - 无 schema 声明文件、无 migration —— rows[0] 的 key 顺序定义当前 schema
 *
 * 写入语义：
 * - 所有写函数走 enqueueSessionWrite 串行化（key = `data:{baseDir}:{objectId}:{name}`），
 *   防止并发 append/write 撕裂 csv 文件结构。
 * - 落盘走 write-then-rename：先写 `.tmp`，再 rename —— 防中途崩溃留下半写文件。
 *
 * csv 编解码：使用自带的 RFC 4180 子集实现（详见 parseCsv / stringifyCsv）。
 * 选择手写而非依赖第三方库的理由：
 * 1. OOC csv 是标准格式（无嵌套表、可能含逗号/双引号的常规值）；
 * 2. 避免依赖增加 supply chain 风险；
 * 3. 实现 < 100 行，覆盖标准转义足够。
 */

import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { enqueueSessionWrite } from "./serial-queue.js";
import { poolDataFile, type PoolObjectRef } from "./pool-object.js";

// =====================================================================
// csv 编解码（RFC 4180 子集：字段含 [,"\n\r] 时整字段用 " 包起来，内部 " 转义为 ""）
// =====================================================================

/**
 * 把一行字段数组序列化为 csv 行（不含末尾换行）。
 *
 * 转义规则：字段含 `,` / `"` / `\n` / `\r` 时整字段用 `"` 包裹，内部 `"` → `""`。
 */
function stringifyRow(fields: string[]): string {
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
function parseCsv(text: string): string[][] {
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

// =====================================================================
// 公共 API
// =====================================================================

/**
 * 读整张表为对象数组；首行作 header。
 *
 * - 文件不存在 → 返回 `[]`（让调用方按"空表"语义处理）。
 * - header 行存在但无数据行 → 返回 `[]`。
 * - 数据行字段数若少于 header，缺位字段补 `""`；多余字段忽略。
 *
 * 返回值类型用 generic `T extends Record<string, string>` —— csv 原生是 string 域，
 * 数字 / 布尔的解析职责留给调用方（避免在底层做隐式类型转换）。
 */
export async function readCsv<T extends Record<string, string>>(
  ref: PoolObjectRef,
  name: string,
): Promise<T[]> {
  const file = poolDataFile(ref, name);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`csv parse failed for ${file}: ${msg}`);
  }
  if (rows.length === 0) return [];
  const header = rows[0]!;
  const out: T[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]!] = r[j] ?? "";
    }
    out.push(obj as T);
  }
  return out;
}

/**
 * 整文件写：`rows[0]` 的 key 作 header；`rows` 为空时写入一个空文件。
 *
 * 选择"rows 空 → 空文件（0 字节）"而不是"写一个空 header 行"：因为空 rows 没法决定
 * header 集合（key 顺序由 rows[0] 决定）。读取端 readCsv 处理空文本时回退 `[]`。
 *
 * 串行化 + 原子写：write-then-rename。
 */
export async function writeCsv<T extends Record<string, string>>(
  ref: PoolObjectRef,
  name: string,
  rows: T[],
): Promise<void> {
  const file = poolDataFile(ref, name);
  return enqueueSessionWrite(`data:${ref.baseDir}:${ref.objectId}:${name}`, async () => {
    await mkdir(dirname(file), { recursive: true });
    if (rows.length === 0) {
      await atomicWriteFile(file, "");
      return;
    }
    const header = Object.keys(rows[0]!);
    const lines: string[] = [stringifyRow(header)];
    for (const row of rows) {
      lines.push(stringifyRow(header.map((k) => row[k] ?? "")));
    }
    await atomicWriteFile(file, lines.join("\n") + "\n");
  });
}

/**
 * 追加一行；文件不存在时用 `row` 的 key 创建 header 后再 append。
 *
 * - 不校验现有 header 与 row.keys 一致性（保持简单；schema drift 由调用方负责）。
 * - 串行化保证：并发 append 不会撕裂行（每次 append 是 read-modify-write 一次完整的原子替换）。
 *
 * 实现走 read-then-rewrite 而不是 fs append：append 模式下并发可能在行边界中间穿插，
 * 而读 → 拼接 → 原子 rename 是与 writeCsv 同样的串行 + 原子语义，更易推理。
 */
export async function appendRow<T extends Record<string, string>>(
  ref: PoolObjectRef,
  name: string,
  row: T,
): Promise<void> {
  const file = poolDataFile(ref, name);
  return enqueueSessionWrite(`data:${ref.baseDir}:${ref.objectId}:${name}`, async () => {
    await mkdir(dirname(file), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing.length === 0) {
      const header = Object.keys(row);
      const text =
        stringifyRow(header) + "\n" + stringifyRow(header.map((k) => row[k] ?? "")) + "\n";
      await atomicWriteFile(file, text);
      return;
    }
    let rows: string[][];
    try {
      rows = parseCsv(existing);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`csv parse failed for ${file}: ${msg}`);
    }
    const header = rows[0] ?? Object.keys(row);
    const newLine = stringifyRow(header.map((k) => row[k] ?? ""));
    // 保留原文件结尾换行风格：若 existing 末尾无换行，补一个再 append
    const sep = existing.endsWith("\n") ? "" : "\n";
    await atomicWriteFile(file, existing + sep + newLine + "\n");
  });
}

// =====================================================================
// internal helpers
// =====================================================================

/**
 * write-then-rename 原子写：先写 `.tmp`，再 rename 覆盖目标。
 *
 * 中途崩溃只会留下 `.tmp` 残留（下次 write 会覆盖），目标文件要么是旧版本
 * 要么是新版本，永远不会出现半写状态。
 */
async function atomicWriteFile(target: string, contents: string): Promise<void> {
  const tmp = `${target}.tmp`;
  try {
    await writeFile(tmp, contents, "utf8");
    await rename(tmp, target);
  } catch (error) {
    // 尽力清理 tmp（如果 rename 前 writeFile 已写出）
    try {
      await unlink(tmp);
    } catch {
      // ignore: tmp 可能根本未创建
    }
    throw error;
  }
}
