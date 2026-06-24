import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/types";
import type { SelfProxy } from "@ooc/core/types";
import type { Data } from "../types.js";
import { isString } from "@ooc/builtins/_shared/executable/utils.js";

interface EditPair {
  old: string;
  new: string;
}

function parseEdits(args: Record<string, unknown>): EditPair[] | undefined {
  if (isString(args.old) && isString(args.new)) {
    return [{ old: args.old, new: args.new }];
  }
  if (Array.isArray(args.edits)) {
    const out: EditPair[] = [];
    for (let i = 0; i < args.edits.length; i += 1) {
      const item = args.edits[i] as Record<string, unknown> | undefined;
      if (!item || !isString(item.old) || !isString(item.new)) return undefined;
      out.push({ old: item.old, new: item.new });
    }
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

function applyEdits(
  initial: string,
  edits: EditPair[],
): { ok: true; result: string } | { ok: false; error: string } {
  let buffer = initial;
  for (let i = 0; i < edits.length; i += 1) {
    const e = edits[i]!;
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = buffer.indexOf(e.old, pos);
      if (idx === -1) break;
      count += 1;
      pos = idx + Math.max(e.old.length, 1);
      if (count > 1) break;
    }
    if (count === 0) {
      return { ok: false, error: `edit #${i}: oldString not found` };
    }
    if (count > 1) {
      let total = 0;
      let p2 = 0;
      while (true) {
        const idx = buffer.indexOf(e.old, p2);
        if (idx === -1) break;
        total += 1;
        p2 = idx + Math.max(e.old.length, 1);
      }
      return { ok: false, error: `edit #${i}: oldString matches ${total} times (must match exactly once)` };
    }
    buffer = buffer.replace(e.old, e.new);
  }
  return { ok: true, result: buffer };
}

const editMethod: ObjectMethod<Data> = {
  name: "edit",
  description: "Precise unique-string replacement on the file; supports atomic multi-edit.",
  schema: {
    old: { type: "string", description: "要替换的旧字符串（必须在文件中正好出现一次）" },
    new: { type: "string", description: "替换后的新字符串" },
    edits: { type: "array", description: "批量替换 [{old, new}, ...]，与 old/new 二选一" },
  },
  exec: async (ctx: ExecutableContext, self: SelfProxy<Data>, args: Record<string, unknown>) => {
    const edits = parseEdits(args);
    if (!edits) {
      return "[file_window.edit] 缺少 args={ old, new } 或 args={ edits: [{old, new}, ...] }。";
    }

    // TODO
  },
};

const executable: ExecutableModule<Data> = {
  methods: [editMethod],
};

export default executable;
