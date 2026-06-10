import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ensureStoneRepo, STONES_MAIN_BRANCH } from "@ooc/core/persistable/stone-bootstrap";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = mkdtempSync(join("/tmp", "stone-bootstrap-test-"));
  await rm(tempRoot, { recursive: true, force: true });
});

describe("ensureStoneRepo (post workspace migration)", () => {
  it("creates flows/, pools/ directories and initializes bare repo", async () => {
    const result = await ensureStoneRepo({ baseDir: tempRoot });
    expect(result.initialized).toBe(true);
    expect(result.migrated).toBe(false);
    expect(result.bootstrapCommit).toBeDefined();
    expect(result.layout).toBe("bare");

    expect(existsSync(join(tempRoot, "flows"))).toBe(true);
    expect(existsSync(join(tempRoot, "pools"))).toBe(true);
    // deprecated packages/ 目录已于 2026-06-07 不再创建（布局移除）
    expect(existsSync(join(tempRoot, "packages"))).toBe(false);
    // Also verifies git repo is initialized
    expect(existsSync(join(tempRoot, "stones", ".stones_repo"))).toBe(true);
    expect(existsSync(join(tempRoot, "stones", "main"))).toBe(true);
  });

  it("is idempotent — second call does not fail and reports initialized=false", async () => {
    const first = await ensureStoneRepo({ baseDir: tempRoot });
    const second = await ensureStoneRepo({ baseDir: tempRoot });
    expect(first.initialized).toBe(true);
    expect(second.initialized).toBe(false); // second call is idempotent skip
    expect(first.migrated).toBe(second.migrated);
    expect(first.layout).toBe(second.layout);
  });

  it("STONES_MAIN_BRANCH constant is still 'main'", () => {
    expect(STONES_MAIN_BRANCH).toBe("main");
  });
});
