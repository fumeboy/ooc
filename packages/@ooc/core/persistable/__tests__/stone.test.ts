import { mkdtemp, readFile, rm, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, stoneDir, stoneMetadataFile } from "../stone-object";
import { readSelf, selfFile, writeSelf } from "../stone-self";
import { readReadme, readReadable, readableFile, readmeFile, writeReadable, writeReadme } from "../stone-readme";
import {
  executableIndexFile,
  readExecutableSource,
  readServerSource,
  serverIndexFile,
  writeExecutableSource,
  writeServerSource,
} from "../stone-server";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("createStoneObject", () => {
  test("creates minimal visible skeleton: .stone.json + self.md + readable.md (2026-06-03 ooc-6)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    const dir = stoneDir(ref);

    // 预创的初始文件：.stone.json / self.md / readable.md
    const metadata = JSON.parse(await readFile(stoneMetadataFile(ref), "utf8"));
    expect(metadata).toEqual({ type: "stone", objectId: "alice" });

    // 空文件占位：ls 可见，但 readSelf/readReadable 返回 ""（loadSelfInstructions 视 empty 等价 undefined）
    expect(await readSelf(ref)).toBe("");
    expect(await readReadable(ref)).toBe("");

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

    // createStoneObject 预创空文件占位；写入覆盖
    expect(await readSelf(ref)).toBe("");
    await writeSelf(ref, "# Alice\n\nI am Alice.");
    expect(await readSelf(ref)).toBe("# Alice\n\nI am Alice.");
    expect(selfFile(ref)).toBe(join(stoneDir(ref), "self.md"));
  });

  test("readable.md round trip (canonical)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

    // createStoneObject 预创空 readable.md
    expect(await readReadable(ref)).toBe("");
    await writeReadable(ref, "Hello visitors.");
    expect(await readReadable(ref)).toBe("Hello visitors.");
    expect(readableFile(ref)).toBe(join(stoneDir(ref), "readable.md"));
    // 迁移完成：writeReadable 不再双写 readme.md
    expect(await readReadme(ref)).toBeUndefined();
  });

  test("readme.md round trip (deprecated API)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = { baseDir: tempRoot, objectId: "bob" };

    // deprecated writeReadme/readReadme 直接操作 readme.md 路径，不依赖预创
    await mkdir(stoneDir(ref), { recursive: true });
    await writeReadme(ref, "Legacy readme content.");
    expect(await readReadme(ref)).toBe("Legacy readme content.");
    expect(readmeFile(ref)).toBe(join(stoneDir(ref), "readme.md"));
  });

  // data.json 迁到 flow 层；详见 src/persistable/__tests__/flow-data.test.ts（待补）。

  test("executable/index.ts round trip (canonical)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "dave" });

    expect(await readExecutableSource(ref)).toBeUndefined();
    const code = "export const window = { commands: { foo: { paths: ['foo'], match: () => ['foo'], exec: async () => ({ ok: true }) } } }; export const ui_methods = {};";
    await writeExecutableSource(ref, code);
    expect(await readExecutableSource(ref)).toBe(code);
    expect(executableIndexFile(ref)).toBe(join(stoneDir(ref), "executable", "index.ts"));
    // 迁移完成：writeExecutableSource 不再双写 server/
    expect(await readServerSource(ref)).toBeUndefined();
  });

  test("server/index.ts round trip (deprecated API)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = { baseDir: tempRoot, objectId: "eve" };

    expect(await readServerSource(ref)).toBeUndefined();
    const code = "export const window = { commands: { foo: { paths: ['foo'], match: () => ['foo'], exec: async () => ({ ok: true }) } } }; export const ui_methods = {};";
    await writeServerSource(ref, code); // writeServerSource 自己 mkdir
    expect(await readServerSource(ref)).toBe(code);
    expect(serverIndexFile(ref)).toBe(join(stoneDir(ref), "server", "index.ts"));
  });
});
