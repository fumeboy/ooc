import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSelf } from "./stone-self";
import { readReadable } from "./stone-readme";

describe("builtin five-piece read goes to framework package (not empty world packages/)", () => {
  test("readSelf(supervisor) returns framework self.md even in an empty world", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-builtin-read-"));
    try {
      const text = await readSelf({ baseDir, objectId: "supervisor" });
      expect(text ?? "").toContain("supervisor");
      // self.md 是有内容的框架身份文件，不应是空占位
      expect((text ?? "").length).toBeGreaterThan(100);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("readReadable(supervisor) returns framework readable.md in an empty world", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-builtin-read-"));
    try {
      const text = await readReadable({ baseDir, objectId: "supervisor" });
      expect((text ?? "").length).toBeGreaterThan(0);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
