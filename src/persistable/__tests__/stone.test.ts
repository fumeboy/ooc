import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, stoneDir, stoneMetadataFile } from "../stone-object";
import { readSelf, selfFile, writeSelf } from "../stone-self";
import { readReadme, readmeFile, writeReadme } from "../stone-readme";
import { dataFile, mergeData, readData, writeData } from "../stone-data";
import { readServerSource, serverIndexFile, writeServerSource } from "../stone-server";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("createStoneObject", () => {
  test("creates full directory skeleton with metadata", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    const dir = stoneDir(ref);
    for (const sub of [
      "knowledge",
      "knowledge/memory",
      "knowledge/relations",
      "server",
      "client",
      "files"
    ]) {
      const stats = await stat(join(dir, sub));
      expect(stats.isDirectory()).toBe(true);
    }

    const metadata = JSON.parse(await readFile(stoneMetadataFile(ref), "utf8"));
    expect(metadata).toEqual({ type: "stone", objectId: "alice" });
  });
});

describe("stone file IO", () => {
  test("self.md round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    expect(await readSelf(ref)).toBeUndefined();
    await writeSelf(ref, "# Alice\n\nI am Alice.");
    expect(await readSelf(ref)).toBe("# Alice\n\nI am Alice.");
    expect(selfFile(ref)).toBe(join(stoneDir(ref), "self.md"));
  });

  test("readme.md round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

    expect(await readReadme(ref)).toBeUndefined();
    await writeReadme(ref, "Hello visitors.");
    expect(await readReadme(ref)).toBe("Hello visitors.");
    expect(readmeFile(ref)).toBe(join(stoneDir(ref), "readme.md"));
  });

  test("data.json round trip + merge", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "charlie" });

    expect(await readData(ref)).toBeUndefined();
    await writeData(ref, { age: 42, city: "Beijing" });
    expect(await readData(ref)).toEqual({ age: 42, city: "Beijing" });

    await mergeData(ref, { city: "Shanghai", role: "engineer" });
    expect(await readData(ref)).toEqual({ age: 42, city: "Shanghai", role: "engineer" });

    expect(dataFile(ref)).toBe(join(stoneDir(ref), "data.json"));
  });

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
