import { mkdir, readFile, writeFile } from "node:fs/promises";
import { flowObjectPaths, threadPaths } from "./paths";
import type {
  FlowObjectMetadata,
  FlowObjectRef,
  LlmInputDebugRecord,
  LlmOutputDebugRecord,
  ThreadPersistenceRef
} from "./types";
import type { ThreadContext } from "../thinkable/context";

/** 序列化 JSON 的统一格式：两空格缩进 + 末尾换行。 */
function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 创建 flow object 目录结构并写入 `.flow.json` 元数据。 */
export async function createFlowObject(ref: FlowObjectRef): Promise<FlowObjectRef> {
  const paths = flowObjectPaths(ref);
  await mkdir(paths.threadsDir, { recursive: true });

  const metadata: FlowObjectMetadata = {
    type: "flow-object",
    sessionId: ref.sessionId,
    objectId: ref.objectId
  };
  await writeFile(paths.flowMetadataFile, toJson(metadata), "utf8");
  return ref;
}

/** 把线程上下文持久化到 `thread.json`；线程未携带 persistence ref 时静默跳过。 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  if (!thread.persistence) return;
  const paths = threadPaths(thread.persistence);
  await mkdir(paths.threadDir, { recursive: true });
  await writeFile(paths.threadFile, toJson(thread), "utf8");
}

/** 从磁盘恢复线程上下文，并把 persistence ref 重新挂上。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string
): Promise<ThreadContext | undefined> {
  const persistence: ThreadPersistenceRef = { ...ref, threadId };
  const paths = threadPaths(persistence);
  try {
    const raw = await readFile(paths.threadFile, "utf8");
    const parsed = JSON.parse(raw) as ThreadContext;
    return { ...parsed, persistence };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入最近一次 LLM 输入快照，覆盖旧文件。 */
export async function writeDebugInput(
  ref: ThreadPersistenceRef,
  record: LlmInputDebugRecord
): Promise<void> {
  const paths = threadPaths(ref);
  await mkdir(paths.debugDir, { recursive: true });
  await writeFile(paths.llmInputFile, toJson(record), "utf8");
}

/** 写入最近一次 LLM 输出快照，覆盖旧文件。 */
export async function writeDebugOutput(
  ref: ThreadPersistenceRef,
  record: LlmOutputDebugRecord
): Promise<void> {
  const paths = threadPaths(ref);
  await mkdir(paths.debugDir, { recursive: true });
  await writeFile(paths.llmOutputFile, toJson(record), "utf8");
}
