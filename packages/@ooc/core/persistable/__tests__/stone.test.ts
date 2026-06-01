import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, stoneDir, stoneMetadataFile } from "../stone-object";
import { readSelf, selfFile, writeSelf } from "../stone-self";
import { readReadme, readmeFile, writeReadme } from "../stone-readme";
import { readServerSource, serverIndexFile, writeServerSource } from "../stone-server";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("createStoneObject", () => {
  test("creates minimal visible skeleton: .stone.json + self.md + readme.md (2026-05-24 visibility-first)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    const dir = stoneDir(ref);

    // 预创的初始文件：.stone.json / self.md / readme.md
    const metadata = JSON.parse(await readFile(stoneMetadataFile(ref), "utf8"));
    expect(metadata).toEqual({ type: "stone", objectId: "alice" });

    // 空文件占位：ls 可见，但 readSelf/readReadme 返回 ""（loadSelfInstructions 视 empty 等价 undefined）
    expect(await readSelf(ref)).toBe("");
    expect(await readReadme(ref)).toBe("");

    // 不预创的子目录：server / client / knowledge / files / database
    // 由对应 IO 函数（writeServerSource / writeStoneClientSource / seed write_file 等）按需 lazy mkdir
    for (const sub of ["server", "client", "knowledge", "files", "database"]) {
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

  test("readme.md round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

    // createStoneObject 预创空文件占位；写入覆盖
    expect(await readReadme(ref)).toBe("");
    await writeReadme(ref, "Hello visitors.");
    expect(await readReadme(ref)).toBe("Hello visitors.");
    expect(readmeFile(ref)).toBe(join(stoneDir(ref), "readme.md"));
  });

  // data.json 迁到 flow 层；详见 src/persistable/__tests__/flow-data.test.ts（待补）。

  test("server/index.ts round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "dave" });

    expect(await readServerSource(ref)).toBeUndefined();
    const code = "export const window = { commands: { foo: { paths: ['foo'], match: () => ['foo'], exec: async () => ({ ok: true }) } } }; export const ui_methods = {};";
    await writeServerSource(ref, code);
    expect(await readServerSource(ref)).toBe(code);
    expect(serverIndexFile(ref)).toBe(join(stoneDir(ref), "server", "index.ts"));
  });
});
