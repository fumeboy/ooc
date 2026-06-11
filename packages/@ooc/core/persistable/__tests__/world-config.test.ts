/**
 * world-config.test — 测试 .world.json 解析与字段校验。
 *
 * 重点覆盖：
 * - workerMaxTicks 解析：number / string / 大小写兼容 / 非法值丢弃
 * - 缓存 (clearWorldConfigCache 复位)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearWorldConfigCache,
  readWorldConfig,
  WORLD_CONFIG_FILENAME,
} from "../world-config";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearWorldConfigCache();
});

async function writeWorldJson(baseDir: string, body: unknown): Promise<void> {
  await writeFile(
    join(baseDir, WORLD_CONFIG_FILENAME),
    typeof body === "string" ? body : JSON.stringify(body),
    "utf8",
  );
}

describe("readWorldConfig: workerMaxTicks", () => {
  test("number 字段被采纳", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: 50 });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBe(50);
  });

  test("PascalCase WorkerMaxTicks 也识别", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { WorkerMaxTicks: 77 });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBe(77);
  });

  test("string 数字被解析", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: "42" });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBe(42);
  });

  test("非法负数被丢弃 (warn + undefined)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: -3 });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBeUndefined();
  });

  test("非整数被丢弃", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: 1.5 });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBeUndefined();
  });

  test("字符串非数字被丢弃", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: "abc" });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBeUndefined();
  });

  test("零值被丢弃 (>0 要求)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: 0 });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBeUndefined();
  });

  test("缺字段时 workerMaxTicks=undefined", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { siteName: "X" });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBeUndefined();
  });

  test(".world.json 不存在时 workerMaxTicks=undefined", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.workerMaxTicks).toBeUndefined();
  });
});

describe("readWorldConfig: prAutoMerge (合入闸)", () => {
  test("缺字段时缺省 false（人工确认更安全）", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { siteName: "X" });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.prAutoMerge).toBe(false);
  });

  test(".world.json 不存在时缺省 false", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.prAutoMerge).toBe(false);
  });

  test("boolean true 被采纳", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { prAutoMerge: true });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.prAutoMerge).toBe(true);
  });

  test("PascalCase PrAutoMerge 也识别", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { PrAutoMerge: true });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.prAutoMerge).toBe(true);
  });

  test("string 'true'/'false' 被解析", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { prAutoMerge: "true" });
    clearWorldConfigCache();
    expect((await readWorldConfig(tempRoot)).prAutoMerge).toBe(true);
    await writeWorldJson(tempRoot, { prAutoMerge: "false" });
    clearWorldConfigCache();
    expect((await readWorldConfig(tempRoot)).prAutoMerge).toBe(false);
  });

  test("非法值 fallback false + warn", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-wcfg-"));
    await writeWorldJson(tempRoot, { prAutoMerge: 123 });
    clearWorldConfigCache();
    const cfg = await readWorldConfig(tempRoot);
    expect(cfg.prAutoMerge).toBe(false);
  });
});
