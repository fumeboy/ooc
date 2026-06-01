import { describe, expect, test, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { clearWorldConfigCache, WORLD_CONFIG_FILENAME } from "@ooc/core/persistable";
import { readServerConfig } from "../config";

describe("readServerConfig: baseDir 归一为绝对路径", () => {
  // 根因 #1 (Round 17): 相对 `--world ./.ooc-world` 不归一会让下游
  // client-source-url 产坏 `/@fs.ooc-world/...`。config 边界必须 path.resolve。
  test("relative --world is resolved to absolute", async () => {
    const cfg = await readServerConfig({ env: {}, argv: ["--world", "./.ooc-world"] });
    expect(isAbsolute(cfg.baseDir)).toBe(true);
    expect(cfg.baseDir).toBe(resolve("./.ooc-world"));
  });

  test("relative OOC_WORLD_DIR env is resolved to absolute", async () => {
    const cfg = await readServerConfig({ env: { OOC_WORLD_DIR: "./.ooc-world" }, argv: [] });
    expect(isAbsolute(cfg.baseDir)).toBe(true);
    expect(cfg.baseDir).toBe(resolve("./.ooc-world"));
  });

  test("absolute --world is kept (resolve is idempotent)", async () => {
    const abs = resolve("/tmp/some-world");
    const cfg = await readServerConfig({ env: {}, argv: ["--world", abs] });
    expect(cfg.baseDir).toBe(abs);
  });

  test("default (process.cwd) is absolute", async () => {
    const cfg = await readServerConfig({ env: {}, argv: [] });
    expect(isAbsolute(cfg.baseDir)).toBe(true);
    expect(cfg.baseDir).toBe(process.cwd());
  });
});

describe("readServerConfig: workerMaxTicks 优先级", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
    clearWorldConfigCache();
  });

  async function writeWorldJson(baseDir: string, body: unknown): Promise<void> {
    await writeFile(join(baseDir, WORLD_CONFIG_FILENAME), JSON.stringify(body), "utf8");
  }

  test(".world.json workerMaxTicks=50 (env 不设) → 50", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-cfg-mt-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: 50 });
    clearWorldConfigCache();
    const cfg = await readServerConfig({ env: {}, argv: ["--world", tempRoot] });
    expect(cfg.workerMaxTicks).toBe(50);
  });

  test(".world.json WorkerMaxTicks=50 (PascalCase) → 50", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-cfg-mt-"));
    await writeWorldJson(tempRoot, { WorkerMaxTicks: 50 });
    clearWorldConfigCache();
    const cfg = await readServerConfig({ env: {}, argv: ["--world", tempRoot] });
    expect(cfg.workerMaxTicks).toBe(50);
  });

  test(".world.json workerMaxTicks=-3 (非法) → 默认 15", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-cfg-mt-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: -3 });
    clearWorldConfigCache();
    const cfg = await readServerConfig({ env: {}, argv: ["--world", tempRoot] });
    expect(cfg.workerMaxTicks).toBe(15);
  });

  test(".world.json workerMaxTicks='abc' (非法) → 默认 15", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-cfg-mt-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: "abc" });
    clearWorldConfigCache();
    const cfg = await readServerConfig({ env: {}, argv: ["--world", tempRoot] });
    expect(cfg.workerMaxTicks).toBe(15);
  });

  test("env=99 + .world.json=50 → env 胜出 99", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-cfg-mt-"));
    await writeWorldJson(tempRoot, { workerMaxTicks: 50 });
    clearWorldConfigCache();
    const cfg = await readServerConfig({
      env: { OOC_WORKER_MAX_TICKS: "99" },
      argv: ["--world", tempRoot],
    });
    expect(cfg.workerMaxTicks).toBe(99);
  });

  test("env / .world.json 都不设 → 默认 15", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-cfg-mt-"));
    clearWorldConfigCache();
    const cfg = await readServerConfig({ env: {}, argv: ["--world", tempRoot] });
    expect(cfg.workerMaxTicks).toBe(15);
  });
});
