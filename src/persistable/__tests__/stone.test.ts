import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, stoneDir, stoneMetadataFile } from "../stone-object";

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
