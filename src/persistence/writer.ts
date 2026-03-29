/**
 * 持久化写入器 (G7)
 *
 * 将对象（Stone）和任务执行（Flow）的状态写入文件系统。
 * 持久化目录就是对象的物理存在。
 *
 * @ref docs/哲学文档/gene.md#G7 — implements — 将对象写入文件系统（writeStone, writeFlow）
 * @ref src/persistence/frontmatter.ts — references — serializeReadme frontmatter 序列化
 * @ref src/types/object.ts — references — StoneData 类型
 * @ref src/types/flow.ts — references — FlowData 类型
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { serializeReadme } from "./frontmatter.js";
import type { StoneData, FlowData } from "../types/index.js";

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 将 Stone 对象写入目录
 *
 * @param dir - 对象目录路径
 * @param stone - Stone 数据
 */
export function writeStone(dir: string, stone: StoneData): void {
  ensureDir(dir);

  /* 写入 readme.md（thinkable + talkable） */
  const readmeContent = serializeReadme(stone.thinkable, stone.talkable);
  writeFileSync(join(dir, "readme.md"), readmeContent, "utf-8");

  /* 写入 data.json（用户数据 + relations） */
  const dataToWrite: Record<string, unknown> = {
    ...stone.data,
    _relations: stone.relations,
  };
  writeFileSync(join(dir, "data.json"), JSON.stringify(dataToWrite, null, 2), "utf-8");

  /* 确保 traits/ 和 reflect/ 目录存在 */
  ensureDir(join(dir, "traits"));
  ensureDir(join(dir, "reflect"));
}

/**
 * 将 Flow 数据写入目录
 *
 * process 数据单独写入 process.json（包含所有 action），
 * data.json 存储元数据（状态、消息等）。
 *
 * @param dir - Flow 目录路径（如 stones/researcher/effects/task_001/）
 * @param flow - Flow 数据
 */
export function writeFlow(dir: string, flow: FlowData): void {
  ensureDir(dir);

  /* 分离 process 和 memory，写入独立文件 */
  const { process, memory, ...flowCore } = flow;

  /* 写入 data.json（不含 process 和 memory） */
  writeFileSync(join(dir, "data.json"), JSON.stringify(flowCore, null, 2), "utf-8");

  /* 写入 process.json */
  writeFileSync(join(dir, "process.json"), JSON.stringify(process, null, 2), "utf-8");

  /* 写入 memory.md（如果有内容） */
  if (memory !== undefined) {
    writeFileSync(join(dir, "memory.md"), memory, "utf-8");
  }

  /* 确保 files/ 目录存在 */
  ensureDir(join(dir, "files"));
}

/**
 * 创建新对象的目录结构
 *
 * @param dir - 对象目录路径
 * @param name - 对象名称
 * @param whoAmI - 对象的自我描述
 * @returns 创建好的 StoneData
 */
export function createObjectDir(dir: string, name: string, whoAmI: string): StoneData {
  const stone: StoneData = {
    name,
    thinkable: { whoAmI },
    talkable: { whoAmI: "", functions: [] },
    data: {},
    relations: [],
    traits: [],
  };

  writeStone(dir, stone);
  /* 写入 .stone 标记文件 */
  writeFileSync(join(dir, ".stone"), "", "utf-8");
  return stone;
}
