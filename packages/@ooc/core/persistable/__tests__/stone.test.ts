import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, stoneDir } from "../stone-object";
import { readSelf, selfFile, writeSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import { readReadable, readableFile, writeReadable } from "../stone-readable";
import {
  executableIndexFile,
  readExecutableSource,
  writeExecutableSource,
} from "../stone-server";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("createStoneObject", () => {
  test("creates minimal skeleton: package.json only（self.md/readable.md 不预创）", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    const dir = stoneDir(ref);

    // 唯一预创文件：package.json。
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.ooc.objectId).toBe("alice");

    // self.md / readable.md 不再预创空文件——self.md 仅 agent 实例由 agent persistable 写入
    // （对象模型核心 9），readable.md 按需 lazy 写入；未写时 readSelf/readReadable 返回 undefined。
    expect(await readSelf(ref)).toBeUndefined();
    expect(await readReadable(ref)).toBeUndefined();

    // 不预创的子目录：executable / visible / knowledge / files / database
    // 以及 legacy server / client。
    // 由对应 IO 函数（writeExecutableSource / writeVisibleSource / seed write_file 等）按需 lazy mkdir
    for (const sub of ["executable", "visible", "server", "client", "knowledge", "files", "database"]) {
      await expect(stat(join(dir, sub))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});

describe("stone file IO", () => {
  test("self.md round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    // createStoneObject 不预创 self.md；未写时 readSelf 返回 undefined，写入后可读回。
    expect(await readSelf(ref)).toBeUndefined();
    await writeSelf(ref, "# Alice\n\nI am Alice.");
    expect(await readSelf(ref)).toBe("# Alice\n\nI am Alice.");
    expect(selfFile(ref)).toBe(join(stoneDir(ref), "self.md"));
  });

  test("readable.md round trip (canonical)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

    // createStoneObject 不预创 readable.md；未写时 readReadable 返回 undefined，写入后可读回。
    expect(await readReadable(ref)).toBeUndefined();
    await writeReadable(ref, "Hello visitors.");
    expect(await readReadable(ref)).toBe("Hello visitors.");
    expect(readableFile(ref)).toBe(join(stoneDir(ref), "readable.md"));
    // 迁移完成：writeReadable 不再双写 readme.md
    await expect(stat(join(stoneDir(ref), "readme.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  // data.json 迁到 flow 层；详见 src/persistable/__tests__/flow-data.test.ts（待补）。

  test("executable/index.ts round trip (canonical)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "dave" });

    expect(await readExecutableSource(ref)).toBeUndefined();
    const code = "export const window = { methods: { foo: { description: 'foo', exec: async () => ({ ok: true }) } } };";
    await writeExecutableSource(ref, code);
    expect(await readExecutableSource(ref)).toBe(code);
    expect(executableIndexFile(ref)).toBe(join(stoneDir(ref), "executable", "index.ts"));
    // 迁移完成：writeExecutableSource 不再双写 server/
    await expect(stat(join(stoneDir(ref), "server", "index.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
