import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureStoneRepo, stoneDir } from "@ooc/core/persistable";
import { readSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import { instantiateBuiltinClassObjects } from "./instantiate-classes";

describe("instantiateBuiltinClassObjects", () => {
  test("instantiates supervisor class into objects/ with copied self.md + ooc.class", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-instantiate-"));
    try {
      await ensureStoneRepo({ baseDir });
      const res = await instantiateBuiltinClassObjects({ baseDir });

      expect(res.instantiated).toContain("supervisor");
      // Wave4：instantiate_with_new_world 字段废弃，改按 ooc.kind==="object" 判定。
      // supervisor / user / feishu_app（BUILTIN_OBJECT_IDS）皆 kind:"object" → 均实例化。
      expect(res.instantiated).toContain("user");

      const dir = stoneDir({ baseDir, objectId: "supervisor" });
      expect(dir.includes("/objects/supervisor")).toBe(true);
      expect(existsSync(join(dir, "package.json"))).toBe(true);

      // package.json 带 ooc.class 指向该 builtin 包声明的父类（supervisor 是 agent → _builtin/agent）
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      expect(pkg.ooc.class).toBe("_builtin/agent");
      expect(pkg.ooc.kind).toBe("object");

      // instance self.md = class self.md 拷贝（非空、含身份）
      const selfText = await readFile(join(dir, "self.md"), "utf8");
      expect(selfText).toContain("总管");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("is idempotent: second run skips existing instance", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-instantiate-"));
    try {
      await ensureStoneRepo({ baseDir });
      await instantiateBuiltinClassObjects({ baseDir });
      // 用户改了 instance self.md
      const dir = stoneDir({ baseDir, objectId: "supervisor" });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(dir, "self.md"), "# 我是被用户改过的 supervisor", "utf8");

      const res2 = await instantiateBuiltinClassObjects({ baseDir });
      expect(res2.skipped).toContain("supervisor");
      expect(res2.instantiated).not.toContain("supervisor");

      // 用户改动被保住
      const selfText = await readSelf({ baseDir, objectId: "_builtin/supervisor" });
      const instanceSelf = await readFile(join(dir, "self.md"), "utf8");
      expect(instanceSelf).toContain("被用户改过");
      expect(selfText).not.toContain("被用户改过"); // 框架 class 未被污染
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
