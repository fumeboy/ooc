/**
 * example —— persistable 维度（自定义序列化，有真实差异的示范）。
 *
 * object 经 persistable **接管自己的 save/load**——决定数据落到哪个文件、长什么样；
 * 不写此面则走系统默认（裸 data → `ctx.dir/data.json`）。
 *
 * 本样例演示一个与默认**有真实差异**的最小自定义：把 Data 落成**人类可读的
 * `ctx.dir/example.md`**（而非默认 JSON `data.json`），同构于真实 builtin `agent`
 * （把 `data.self` 写成可读的 `self.md`）。掌控格式的代价就是自己 parse 回来——load 与 save 对称。
 *
 * 注意（真实考量）：自定义文件名（`example.md`）**不在**默认 gitignore 黑名单
 * （`objects/**​/data.json`）内——若你的自定义文件落进 stone 且不该版本化，记得在 world
 * 的 `.gitignore` 补上。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  PersistableContext,
  PersistableModule,
} from "@ooc/core/types/persistable.js";
import type { Data } from "../types.js";

const FILE = "example.md";

function file(ctx: PersistableContext): string {
  return join(ctx.dir, FILE);
}

const persistable: PersistableModule<Data> = {
  // 自选可读格式：bumpCount 一行 header + message 正文（可多行）——非默认裸 JSON。
  save: async (ctx: PersistableContext, data: Data) => {
    const f = file(ctx);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, `bumpCount: ${data.bumpCount}\n\n${data.message}\n`, "utf8");
  },
  // 自己 parse 回来：header 行取 bumpCount，其后正文即 message（兼容多行）。
  load: async (ctx: PersistableContext): Promise<Data | undefined> => {
    try {
      const txt = await readFile(file(ctx), "utf8");
      const bumpCount = Number(/^bumpCount: (\d+)$/m.exec(txt)?.[1] ?? 0);
      const message = txt.replace(/^bumpCount: \d+\n\n?/, "").replace(/\n$/, "");
      return { message, bumpCount };
    } catch {
      return undefined;
    }
  },
};

export default persistable;
