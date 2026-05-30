// src/executable/prototype/__tests__/object-record.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { rm as rmFile } from "node:fs/promises";
import {
  createStoneObject,
  writeSelf,
  writeExecutableSource,
  writeReadable,
  selfFile,
} from "../../../persistable";
import { loadObjectRecord } from "../object-record";

let tempRoot: string | undefined;
afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("loadObjectRecord", () => {
  test("default extends is root; empty readable.md placeholder counts as absent", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-proto-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });
    await writeSelf(ref, "# x\nplain identity");
    const rec = await loadObjectRecord(ref);
    expect(rec.id).toBe("ooc://stones/main/objects/x");
    expect(rec.extends).toBe("ooc://stones/_builtin/objects/root");
    // createStoneObject 预创建空 readable.md → 非空判定下应为 false（空占位 ≡ 缺失）
    expect(rec.has.executable).toBe(false);
    expect(rec.has.readable).toBe(false);
    expect(rec.has.visible).toBe(false);
  });

  test("parses extends frontmatter and detects executable presence by non-empty content", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-proto-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "y" });
    await writeSelf(ref, "---\nextends: search\n---\nidentity body");
    await writeExecutableSource(ref, `export const window = { commands: {} };`);
    const rec = await loadObjectRecord(ref);
    expect(rec.extends).toBe("ooc://stones/_builtin/objects/search");
    expect(rec.has.executable).toBe(true);
    expect(rec.has.readable).toBe(false);
  });

  test("detects readable presence when readable.md has non-empty content", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-proto-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "z" });
    await writeSelf(ref, "# z");
    await writeReadable(ref, "I am z, here for others to read.");
    const rec = await loadObjectRecord(ref);
    expect(rec.has.readable).toBe(true);
  });

  test("throws when self.md is missing (not an object)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-proto-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "no-self" });
    // createStoneObject 预创建空 self.md → 须先删才能模拟"非 Object"。空 self.md 本身合法。
    await rmFile(selfFile(ref), { force: true });
    await expect(loadObjectRecord(ref)).rejects.toThrow(/self\.md/);
  });
});
