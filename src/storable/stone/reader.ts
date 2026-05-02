/**
 * 持久化读取器 (G7)
 *
 * 从文件系统读取对象（Stone）和任务执行（Flow）的状态。
 * 目录存在 = 对象存在。
 *
 * @ref docs/哲学文档/gene.md#G7 — implements — 从文件系统读取对象（readStone, readFlow, listObjects）
 * @ref src/storable/frontmatter.ts — references — parseReadme frontmatter 解析
 * @ref src/shared/types/object.ts — references — StoneData 类型
 * @ref src/shared/types/flow.ts — references — FlowData 类型
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseReadme } from "../frontmatter.js";
import { createProcess } from "../thread/process-compat.js";
import { threadsToProcess } from "../thread/thread-adapter.js";
import type { StoneData, FlowData, Relation } from "../../shared/types/index.js";

/**
 * 从目录读取 Stone 对象
 *
 * @param dir - 对象目录路径（如 stones/researcher/）
 * @returns Stone 数据，若目录不存在返回 null
 */
export function readStone(dir: string): StoneData | null {
  if (!existsSync(dir)) return null;

  const name = dir.split("/").pop()!;
  const readmePath = join(dir, "readme.md");
  const dataPath = join(dir, "data.json");

  /* 解析 readme.md → thinkable + talkable */
  let thinkable = { whoAmI: "" };
  let talkable = { whoAmI: "", functions: [] as StoneData["talkable"]["functions"] };

  if (existsSync(readmePath)) {
    const content = readFileSync(readmePath, "utf-8");
    const parsed = parseReadme(content);
    thinkable = parsed.thinkable;
    talkable = parsed.talkable;
  }

  /* 读取 data.json */
  let data: Record<string, unknown> = {};
  if (existsSync(dataPath)) {
    try {
      data = JSON.parse(readFileSync(dataPath, "utf-8")) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  /* 从 data 中提取 relations（如果有） */
  const relations: Relation[] = Array.isArray(data._relations)
    ? (data._relations as Relation[])
    : [];
  delete data._traits_ref;

  /* 扫描 traits/ 目录获取 trait 名称列表 */
  const traitsDir = join(dir, "traits");
  let traits: string[] = [];
  if (existsSync(traitsDir)) {
    traits = readdirSync(traitsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  /* 读取 memory.md（长期记忆索引） */
  const memoryPath = join(dir, "memory.md");
  const memory = existsSync(memoryPath) ? readFileSync(memoryPath, "utf-8") : undefined;

  return {
    name,
    thinkable,
    talkable,
    data: data,
    relations,
    traits,
    memory,
  };
}

/**
 * 从目录读取 Flow 数据
 *
 * 自动合并 process.json 到 FlowData.process 字段。
 * 旧版数据若无 process.json，自动创建默认 process。
 *
 * @param dir - Flow 目录路径（如 stones/researcher/effects/task_001/）
 * @returns Flow 数据，若目录不存在返回 null
 */
export function readFlow(dir: string): FlowData | null {
  if (!existsSync(dir)) return null;

  const dataPath = join(dir, "data.json");
  if (!existsSync(dataPath)) return null;

  try {
    const flow = JSON.parse(readFileSync(dataPath, "utf-8")) as FlowData;

    /* 合并独立的 process.json */
    const processPath = join(dir, "process.json");
    if (existsSync(processPath)) {
      try {
        flow.process = JSON.parse(readFileSync(processPath, "utf-8"));
      } catch {
        /* process.json 解析失败，创建默认 */
        flow.process = createProcess("task");
      }
    } else {
      /* 尝试从线程树数据构建 process */
      const threadProcess = threadsToProcess(dir);
      if (threadProcess) {
        flow.process = threadProcess;
      } else {
        /* 旧版数据无 process.json 也无线程树，创建默认 */
        flow.process = createProcess("task");
      }
    }

    /* 读取 memory.md（会话级记忆） */
    const memoryPath = join(dir, "memory.md");
    if (existsSync(memoryPath)) {
      flow.memory = readFileSync(memoryPath, "utf-8");
    }

    /* 清理旧版 actions 字段（如果存在） */
    delete (flow as any).actions;

    return flow;
  } catch {
    return null;
  }
}

/**
 * 列出顶层 flows/ 目录下所有 session ID
 *
 * @param flowsDir - 顶层 flows 目录路径（如 flows/）
 * @returns session ID 列表
 */
export function listFlowSessions(flowsDir: string): string[] {
  if (!existsSync(flowsDir)) return [];

  return readdirSync(flowsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
    .map((d) => d.name)
    .filter((sessionId) => {
      const sessionDir = join(flowsDir, sessionId);

      // 新结构：以 flows/<sessionId>/.session.json 作为 session 存在的判定
      if (existsSync(join(sessionDir, ".session.json"))) return true;

      // 兼容旧结构：session 根目录存在 data.json
      if (existsSync(join(sessionDir, "data.json"))) return true;

      // 兼容：session/objects/<name>/data.json
      const objectsDir = join(sessionDir, "objects");
      if (!existsSync(objectsDir)) return false;
      try {
        for (const entry of readdirSync(objectsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (existsSync(join(objectsDir, entry.name, "data.json"))) return true;
        }
      } catch {
        return false;
      }
      return false;
    });
}

/**
 * 列出所有对象名称
 *
 * @param objectsRoot - 对象根目录（如 stones/）
 * @returns 对象名称列表
 */
export function listObjects(objectsRoot: string): string[] {
  if (!existsSync(objectsRoot)) return [];

  return readdirSync(objectsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
