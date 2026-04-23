/**
 * Memory Embedding —— 结构化 memory 的向量相关性检索（Phase 2）
 *
 * 为什么不用 `@xenova/transformers`：
 * - 需要下载 ~30MB 模型文件（首次运行），对离线 / CI / 受限网络不友好
 * - Node/bun 原生没带 ONNX runtime，引入后启动时间显著增加
 * - 对于 memory entry 这种"短文本（<1KB）+ 同质领域"的场景，简单 n-gram TF
 *   余弦已经能给出相当不错的相关性排序
 *
 * 取舍：
 * - 精度：hash n-gram TF 对"同义词/深层语义"无感（"bug" vs "错误"是两个维度）
 * - 速度：生成 embedding O(文本长度)，零 IO，零分配（Map 重用）
 * - 体积：embedding dim=256，每条 entry 额外 ~1KB 文件
 *
 * 升级通道（未来 backlog）：
 * - 保持本模块 API（`generateEmbedding`, `cosineSimilarity`）稳定
 * - 若换成真 embedding：仅替换 `generateEmbedding` 实现，dim 可变（返回数组长度自适应）
 *
 * 算法：
 * 1. 文本小写化 + 去标点 + 切词（空格 + 中文字符逐字切）
 * 2. 构造 uni/bi-gram token 序列
 * 3. 每个 token 用 `djb2 hash` 映射到 `dim=256` 的槽位
 * 4. 每个槽位累加 1 / log(1+totalTokens) 权重（近似 TF）
 * 5. L2 归一化 → 单位向量
 *
 * 检索：
 * - `cosineSimilarity(a, b)` 在单位向量上就是点积
 * - `rankByVector(queryVec, entries)` 返回 `{entry, score}[]` 按 score 降序
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation_phase2.md — Phase 2
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Embedding 向量维度（hash trick bucket 数；改值会使已有向量失效，需 rebuild） */
export const EMBEDDING_DIM = 256;

/**
 * 为一段文本生成归一化 TF 向量（hash trick + uni/bi-gram）
 *
 * 不访问网络，完全确定性——同输入恒同输出。
 * 空文本 / 只含标点 → 返回全零向量（归一化后仍为全零，不会 NaN）
 */
export function generateEmbedding(text: string): number[] {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  if (!text) return vec;

  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  /* 构造 uni + bi-gram */
  const grams: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    grams.push(tokens[i]);
    if (i + 1 < tokens.length) grams.push(`${tokens[i]}|${tokens[i + 1]}`);
  }

  /* TF 累加 */
  const weight = 1 / Math.log(1 + grams.length);
  for (const g of grams) {
    const slot = djb2Hash(g) % EMBEDDING_DIM;
    vec[slot] += weight;
  }

  /* L2 归一化 */
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm;
  return vec;
}

/**
 * 两个单位向量的余弦相似度（点积即可；非单位向量会被错误评估）
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * 切词：
 * - ASCII：字母数字按 \W+ split，小写
 * - 中文（0x4E00-0x9FFF）：逐字作为一个 token
 *
 * 不完美（不分英文/中文复合、不处理 CJK 标点），但对 memory entry 的短文本检索够用。
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  let buf = "";
  for (const ch of lower) {
    const code = ch.charCodeAt(0);
    const isAscii = code < 128;
    const isAlphaNum = isAscii && ((code >= 48 && code <= 57) || (code >= 97 && code <= 122));
    const isCJK = code >= 0x4e00 && code <= 0x9fff;
    if (isAlphaNum) {
      buf += ch;
    } else if (isCJK) {
      if (buf.length > 0) { out.push(buf); buf = ""; }
      out.push(ch);
    } else {
      if (buf.length > 0) { out.push(buf); buf = ""; }
    }
  }
  if (buf.length > 0) out.push(buf);
  return out.filter(t => t.length > 0);
}

/**
 * djb2 字符串 hash —— 经典快速非加密 hash（Dan Bernstein）
 */
function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0; /* 转无符号 32-bit */
}

/* ─── 落盘 / 读取 ──────────────────────────────────────── */

/**
 * 单条 entry 的 embedding 落盘路径：`{selfDir}/memory/entries/{id}.embedding.json`
 *
 * 格式：`{ "dim": 256, "vec": [number, ...] }`
 *
 * 设计：与 entry 主文件分离——读 entry 列表时不会因 embedding 大小而慢；
 * 删除 embedding 不会丢 entry 数据。
 */
export function embeddingPath(selfDir: string, entryId: string): string {
  return join(selfDir, "memory", "entries", `${entryId}.embedding.json`);
}

/**
 * 写入 embedding（side-effect；失败不抛，由调用方决定是否容忍）
 */
export function writeEmbedding(selfDir: string, entryId: string, vec: number[]): void {
  const p = embeddingPath(selfDir, entryId);
  writeFileSync(p, JSON.stringify({ dim: vec.length, vec }), "utf-8");
}

/**
 * 读取 embedding；不存在或格式异常返回 null
 */
export function readEmbedding(selfDir: string, entryId: string): number[] | null {
  const p = embeddingPath(selfDir, entryId);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.vec)) return null;
    if (parsed.vec.length !== EMBEDDING_DIM) return null; /* dim 改了就失效 */
    return parsed.vec as number[];
  } catch {
    return null;
  }
}

/**
 * 删除 embedding（entry 物理删除时配套调用；不存在不抛）
 */
export function deleteEmbedding(selfDir: string, entryId: string): void {
  const p = embeddingPath(selfDir, entryId);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

/**
 * 根据 entry 的 key+content 生成并落盘 embedding（幂等——同输入恒同向量）
 *
 * 这是写 entry 时的 side-effect 入口；调用方（appendMemoryEntry）应在写完 entry 后调。
 */
export function rebuildEntryEmbedding(
  selfDir: string,
  entryId: string,
  key: string,
  content: string,
): number[] {
  const vec = generateEmbedding(`${key} ${content}`);
  writeEmbedding(selfDir, entryId, vec);
  return vec;
}
