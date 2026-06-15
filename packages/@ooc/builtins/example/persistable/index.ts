/**
 * example —— persistable 维度（自定义序列化）。
 *
 * object 经 persistable 自定义自己的**序列化目录与方式**；不写此文件则走系统默认持久化。
 * 这里给一个最小参照实现：把 Data 以 JSON 落在系统解析好的实例目录 `ctx.dir/data.json`。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  PersistableContext,
  PersistableModule,
} from "@ooc/core/persistable/contract.js";
import type { Data } from "../types.js";

function dataFile(ctx: PersistableContext): string {
  return join(ctx.dir, "data.json");
}

const persistable: PersistableModule<Data> = {
  save: async (ctx: PersistableContext, data: Data) => {
    const file = dataFile(ctx);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), "utf8");
  },
  load: async (ctx: PersistableContext): Promise<Data | undefined> => {
    try {
      const raw = await readFile(dataFile(ctx), "utf8");
      return JSON.parse(raw) as Data;
    } catch {
      return undefined;
    }
  },
};

export default persistable;
