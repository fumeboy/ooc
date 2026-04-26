/**
 * open → refine → submit 完整流程集成测试（scaffold；完整断言在 Task 8 加）
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("open → refine → submit flow scaffold", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "refine-flow-"));
    mkdirSync(join(tmp, "stones", "alice"), { recursive: true });
    writeFileSync(join(tmp, "stones", "alice", "readme.md"), "# alice\n");
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test("scaffold compiles and tmpdir set up", () => {
    expect(tmp).toBeTruthy();
  });
});
