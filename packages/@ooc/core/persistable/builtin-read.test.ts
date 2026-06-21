import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import { readReadable } from "./stone-readable";

describe("builtin class five-piece read goes to framework package (via _builtin/ addressing)", () => {
  test("readSelf(_builtin/supervisor) returns framework self.md even in an empty world", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-builtin-read-"));
    try {
      const text = await readSelf({ baseDir, objectId: "_builtin/supervisor" });
      expect(text ?? "").toContain("supervisor");
      // self.md 是有内容的框架身份文件，不应是空占位
      expect((text ?? "").length).toBeGreaterThan(100);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("readReadable(_builtin/supervisor) returns framework readable.md in an empty world", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-builtin-read-"));
    try {
      const text = await readReadable({ baseDir, objectId: "_builtin/supervisor" });
      expect((text ?? "").length).toBeGreaterThan(0);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("bare builtin id (supervisor) does NOT read framework (resolves to instance objects/ dir)", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-builtin-read-"));
    try {
      // 空 world 无实例 → undefined（不再被框架遮蔽）
      const text = await readSelf({ baseDir, objectId: "supervisor" });
      expect(text).toBeUndefined();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
