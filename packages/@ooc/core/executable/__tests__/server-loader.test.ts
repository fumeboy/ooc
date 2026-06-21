/**
 * server-loader.test — ServerLoader.loadStoneClass（Wave 4 对象模型）。
 *
 * loader 从 stone 目录的根 `index.ts` 动态 import `export const Class`（OocClass 装配入口：
 * construct / executable / readable / persistable）+ 读 package.json `ooc.class` 拿继承父类，
 * 按 index.ts mtime 缓存。无 index.ts（纯 self.md / readable.md 对象）返回 undefined。
 *
 * 旧 `loadObjectWindow`（读 executable/index.ts 的 `export const window={methods}` barrel）+
 * 单参 exec 已退役——loader 不再读 barrel，本测试对齐到 `loadStoneClass` + 三维度 Class 契约。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject } from "../../persistable";
import { stoneDir } from "@ooc/core/persistable/common.js";
import { clearServerLoaderCache, loadStoneClass } from "@ooc/core/runtime/server-loader";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearServerLoaderCache();
});

/** 把一段 `export const Class = …` 源码写进 stone 根 index.ts（loader 的真实 import 入口）。 */
async function writeStoneIndex(ref: { baseDir: string; objectId: string }, code: string) {
  const dir = stoneDir(ref);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.ts"), code, "utf8");
}

describe("loadStoneClass", () => {
  test("returns undefined when index.ts is missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    // createStoneObject 写 package.json，但不写根 index.ts。
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });
    const loaded = await loadStoneClass(ref);
    expect(loaded).toBeUndefined();
  });

  test("loads `export const Class` with executable methods from index.ts", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeStoneIndex(
      ref,
      `export const Class = {
        executable: {
          methods: [
            {
              name: "echo",
              description: "echo back",
              exec: async (_ctx, _self, args) => String(args.text),
            },
          ],
        },
      };`,
    );

    const loaded = await loadStoneClass(ref);
    expect(loaded).toBeDefined();
    const methods = loaded!.cls.executable?.methods ?? [];
    expect(methods.map((m) => m.name)).toEqual(["echo"]);
    // 三参 exec（ctx, self, args）。
    const out = await methods[0]!.exec({} as never, {} as never, { text: "hi" });
    expect(out).toBe("hi");
  });

  test("carries parentClass from package.json ooc.class", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    // ooc.class 声明单跳继承父类。
    const ref = await createStoneObject(
      { baseDir: tempRoot, objectId: "x" },
      { class: "_builtin/agent" },
    );
    await writeStoneIndex(ref, `export const Class = {};`);

    const loaded = await loadStoneClass(ref);
    expect(loaded).toBeDefined();
    expect(loaded!.parentClass).toBe("_builtin/agent");
  });

  test("reloads when index.ts mtime changes", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeStoneIndex(
      ref,
      `export const Class = { executable: { methods: [{ name: "v1", exec: async () => "1" }] } };`,
    );
    let loaded = await loadStoneClass(ref);
    expect((loaded!.cls.executable?.methods ?? []).map((m) => m.name)).toEqual(["v1"]);

    await new Promise((r) => setTimeout(r, 5));
    await writeStoneIndex(
      ref,
      `export const Class = { executable: { methods: [{ name: "v2", exec: async () => "2" }] } };`,
    );

    loaded = await loadStoneClass(ref);
    expect((loaded!.cls.executable?.methods ?? []).map((m) => m.name)).toEqual(["v2"]);
  });

  test("throws when index.ts has no `export const Class`", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });
    await writeStoneIndex(ref, `export const NotClass = { foo: 1 };`);

    await expect(loadStoneClass(ref)).rejects.toThrow(/export const Class/);
  });
});
