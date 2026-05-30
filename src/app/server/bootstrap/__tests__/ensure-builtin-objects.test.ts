// src/app/server/bootstrap/__tests__/ensure-builtin-objects.test.ts
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { ensureBuiltinObjects } from "../ensure-builtin-objects";
import { BUILTIN_PROTOTYPES } from "../builtin-seed";

let tempRoot: string | undefined;
afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function selfPath(baseDir: string, proto: string): string {
  return join(baseDir, "stones", "_builtin", "objects", proto, "self.md");
}
function readablePath(baseDir: string, proto: string): string {
  return join(baseDir, "stones", "_builtin", "objects", proto, "readable.md");
}

describe("ensureBuiltinObjects", () => {
  test("materializes all 8 prototypes with extends frontmatter", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-builtin-"));
    const result = await ensureBuiltinObjects({ baseDir: tempRoot });
    expect(result.materialized.sort()).toEqual(
      ["command_exec", "custom", "file", "knowledge", "program", "root", "search", "skill_index"],
    );
    // root: extends null
    const rootSelf = await readFile(selfPath(tempRoot, "root"), "utf8");
    expect(rootSelf).toContain("extends: null");
    // program: extends root
    const progSelf = await readFile(selfPath(tempRoot, "program"), "utf8");
    expect(progSelf).toContain("extends: root");
  });

  test("root has non-empty readable.md; non-root protos leave empty placeholder", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-builtin-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const rootReadable = await readFile(readablePath(tempRoot, "root"), "utf8");
    expect(rootReadable.trim().length).toBeGreaterThan(0);
    const progReadable = await readFile(readablePath(tempRoot, "program"), "utf8");
    expect(progReadable.trim().length).toBe(0);
  });

  test("idempotent: running twice yields stable content (overwrite-regenerate)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-builtin-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const firstRoot = await readFile(selfPath(tempRoot, "root"), "utf8");
    const second = await ensureBuiltinObjects({ baseDir: tempRoot });
    expect(second.materialized.length).toBe(BUILTIN_PROTOTYPES.length);
    const secondRoot = await readFile(selfPath(tempRoot, "root"), "utf8");
    expect(secondRoot).toBe(firstRoot);
  });
});
