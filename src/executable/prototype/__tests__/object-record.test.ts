// src/executable/prototype/__tests__/object-record.test.ts
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { loadObjectRecord } from "../object-record";

const dirs: string[] = [];
async function tmpObjectDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "ooc-rec-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe("loadObjectRecord", () => {
  test("default extends is root when self.md has no frontmatter; absent slots are false", async () => {
    const dir = await tmpObjectDir();
    await writeFile(join(dir, "self.md"), "# x\nplain identity", "utf8");
    const rec = await loadObjectRecord(dir, "ooc://test/x");
    expect(rec.id).toBe("ooc://test/x");
    expect(rec.dir).toBe(dir);
    expect(rec.extends).toBe("ooc://stones/_builtin/objects/root");
    expect(rec.has.executable).toBe(false);
    expect(rec.has.readable).toBe(false);
    expect(rec.has.visible).toBe(false);
  });

  test("parses extends frontmatter and detects executable by non-empty content", async () => {
    const dir = await tmpObjectDir();
    await writeFile(join(dir, "self.md"), "---\nextends: search\n---\nidentity body", "utf8");
    await mkdir(join(dir, "executable"), { recursive: true });
    await writeFile(join(dir, "executable", "index.ts"), "export const window = { commands: {} };", "utf8");
    const rec = await loadObjectRecord(dir, "ooc://test/y");
    expect(rec.extends).toBe("ooc://stones/_builtin/objects/search");
    expect(rec.has.executable).toBe(true);
    expect(rec.has.readable).toBe(false);
  });

  test("detects readable presence when readable.md non-empty; empty/whitespace ≡ absent", async () => {
    const dir = await tmpObjectDir();
    await writeFile(join(dir, "self.md"), "# z", "utf8");
    await writeFile(join(dir, "readable.md"), "I am z, here for others to read.", "utf8");
    expect((await loadObjectRecord(dir, "ooc://test/z")).has.readable).toBe(true);

    // 空白 readable.md ≡ 缺失
    await writeFile(join(dir, "readable.md"), "   \n  ", "utf8");
    expect((await loadObjectRecord(dir, "ooc://test/z")).has.readable).toBe(false);
  });

  test("throws when self.md is missing (not an object)", async () => {
    const dir = await tmpObjectDir();
    await expect(loadObjectRecord(dir, "ooc://test/none")).rejects.toThrow(/self\.md/);
  });
});
