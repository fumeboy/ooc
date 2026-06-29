/**
 * loop-debug — thinkloop 每轮落盘 input/output/meta JSON (S9, 2026-06-29)。
 *
 * **设计权威**: app/self.md ## runtime + observable 维度
 *   debug=on 时, thread 每轮 thinkloop 落盘 loop_NNNN.{input,output,meta}.json,
 *   供 LoopTimeline UI 查看 ('时光机' 模式)。
 *
 * 落盘位置: `flows/<sid>/objects/<oid>/threads/<tid>/debug/loop_NNNN.{input|output|meta}.json`
 *
 * 触发条件 (运行时):
 *   - isDebugEnabled() = true (S8 debug-store toggle)
 *   - thread 经 thinkloop.think 一轮真跑 (mock LLM 也算)
 *
 * 落盘失败不影响 thinkloop 正常运行 (observable 铁律:不改 agent 行为)。
 */
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDebugEnabled } from "./debug-store.js";

/** loop debug 文件落盘路径前缀 — flows/<sid>/objects/<oid>/threads/<tid>/debug/。 */
function debugDirOf(args: {
  baseDir: string;
  sessionId: string;
  objectId: string;
  threadId: string;
}): string {
  return join(
    args.baseDir,
    "flows",
    args.sessionId,
    "objects",
    args.objectId,
    "threads",
    args.threadId,
    "debug",
  );
}

/**
 * 落盘 loop debug 三件套 (input/output/meta)。
 *
 * loopIndex 由 caller (thinkloop) 在 think 入口算: thread.events 中 call_started 数量。
 * 若 debug=off 直接 no-op。
 */
export async function writeLoopDebug(args: {
  baseDir: string;
  sessionId: string;
  objectId: string;
  threadId: string;
  loopIndex: number;
  input: unknown;
  output: unknown;
  meta: Record<string, unknown>;
}): Promise<void> {
  if (!isDebugEnabled()) return;
  try {
    const dir = debugDirOf(args);
    await mkdir(dir, { recursive: true });
    const nnnn = String(args.loopIndex).padStart(4, "0");
    await writeFile(
      join(dir, `loop_${nnnn}.input.json`),
      JSON.stringify(args.input, null, 2),
      "utf8",
    );
    await writeFile(
      join(dir, `loop_${nnnn}.output.json`),
      JSON.stringify(args.output, null, 2),
      "utf8",
    );
    await writeFile(
      join(dir, `loop_${nnnn}.meta.json`),
      JSON.stringify({ ...args.meta, loopIndex: args.loopIndex }, null, 2),
      "utf8",
    );
  } catch (err) {
    // 不阻塞 thinkloop;只 console.warn (observable 铁律)
    console.warn(`[loop-debug] writeLoopDebug failed: ${(err as Error).message}`);
  }
}

/** 列 thread 下所有 loop 文件 (按 loopIndex 升序),不读 input/output 全文。 */
export async function listLoops(args: {
  baseDir: string;
  sessionId: string;
  objectId: string;
  threadId: string;
}): Promise<Array<{ loopIndex: number; createdAt?: number; meta?: Record<string, unknown> }>> {
  const dir = debugDirOf(args);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  // 收集所有 .meta.json
  const metas: Array<{ loopIndex: number; createdAt?: number; meta?: Record<string, unknown> }> = [];
  for (const f of entries) {
    const m = f.match(/^loop_(\d{4})\.meta\.json$/);
    if (!m) continue;
    const loopIndex = parseInt(m[1]!, 10);
    try {
      const raw = await readFile(join(dir, f), "utf8");
      const meta = JSON.parse(raw) as Record<string, unknown>;
      metas.push({
        loopIndex,
        createdAt: typeof meta.createdAt === "number" ? meta.createdAt : undefined,
        meta,
      });
    } catch {
      // 单文件解析失败, 不破坏整批
      metas.push({ loopIndex });
    }
  }
  return metas.sort((a, b) => a.loopIndex - b.loopIndex);
}

/** 读单个 loop 完整三元组。 */
export async function readLoopDebug(args: {
  baseDir: string;
  sessionId: string;
  objectId: string;
  threadId: string;
  loopIndex: number;
}): Promise<
  | { ok: true; input: unknown; output: unknown; meta: Record<string, unknown> }
  | { ok: false; code: string; message: string }
> {
  const dir = debugDirOf(args);
  const nnnn = String(args.loopIndex).padStart(4, "0");
  try {
    const [inputRaw, outputRaw, metaRaw] = await Promise.all([
      readFile(join(dir, `loop_${nnnn}.input.json`), "utf8"),
      readFile(join(dir, `loop_${nnnn}.output.json`), "utf8"),
      readFile(join(dir, `loop_${nnnn}.meta.json`), "utf8"),
    ]);
    return {
      ok: true,
      input: JSON.parse(inputRaw),
      output: JSON.parse(outputRaw),
      meta: JSON.parse(metaRaw) as Record<string, unknown>,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code === "ENOENT" ? "LOOP_NOT_FOUND" : "READ_FAILED";
    return { ok: false, code, message: (err as Error).message };
  }
}
