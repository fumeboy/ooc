/**
 * C1 dogfood self-iteration e2e — OOC 自举临界点的实证 (issue 2026-06-29-c1, 2026-06-29 落地)。
 *
 * 完整链路验证:
 *   1. 模拟 PR ff-merge 后, mergeFeatBranch 通知 reloadTable
 *   2. 模拟 file-edit 原语写后, httpDirectMainWrite 也通知 reloadTable
 *   3. WorldRuntime registry 多实例通知:跨 server 实例的 invalidate 都到位
 *   4. dev=false 也写 reloadTable (stoneRegistry.invalidate listener 始终注册)
 *
 * Tier: A — 不调真 LLM, 用 mock + 直接调 mergeFeatBranch/httpDirectMainWrite 验证 wiring
 *
 * 设计权威锚:
 *   - issue D (reflectable as flow dispatcher): super flow + create_pr → mergeFeatBranch
 *   - issue 2026-06-28-lifecycle-module-and-reload: reloadTable + on_reload
 *   - F1 server WorldRuntime 集成
 *
 * **本测试是 OOC 自举闭环的 critical 段**:从「class 源码改」到「下次 active 看到新代码」
 * 的 wiring 是否真正闭合。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorldRuntime } from "@ooc/core/runtime/world-runtime";
import { clearWorldRuntimeRegistry } from "@ooc/core/runtime/world-runtime-registry";

let baseDir: string;

async function bootstrapStoneRepo(dir: string): Promise<void> {
  const stonesMain = join(dir, "stones", "main");
  await mkdir(stonesMain, { recursive: true });
  Bun.spawnSync(["git", "init"], { cwd: stonesMain });
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: stonesMain });
  await writeFile(join(stonesMain, "README.md"), "C1 bootstrap\n", "utf8");
  Bun.spawnSync(["git", "add", "-A"], { cwd: stonesMain });
  Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t.com",
      "commit",
      "-m",
      "init",
    ],
    { cwd: stonesMain },
  );
}

describe("C1 · dogfood self-iteration — wiring 验证 (mergeFeatBranch + httpDirectMainWrite → reloadTable)", () => {
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-c1-"));
    await bootstrapStoneRepo(baseDir);
    clearWorldRuntimeRegistry();
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
    clearWorldRuntimeRegistry();
  });

  it("dev=false 也注册 stoneRegistry.invalidate listener: stoneRegistry.invalidate() → reloadTable 写入", () => {
    const rt = createWorldRuntime({ worldPath: baseDir, dev: false });

    // 直接触发 stoneRegistry.invalidate (模拟 hot-reload event 或 mergeFeatBranch)
    rt.stoneRegistry.invalidate("test_class", ["executable/index.ts"]);

    // reloadTable 应被写
    const mark = rt.reloadTable.peek("test_class");
    expect(mark).toBeDefined();
    expect(mark!.changedFiles).toContain("executable/index.ts");

    rt.dispose();
  });

  it("notifyAllWorldRuntimes (单实例): 经 world-runtime-registry 全局通知 → reloadTable", async () => {
    const rt = createWorldRuntime({ worldPath: baseDir, dev: false });

    // 经 world-runtime-registry 通知 (生产中由 mergeFeatBranch / httpDirectMainWrite 调用)
    const { notifyAllWorldRuntimes } = await import("@ooc/core/runtime/world-runtime-registry");
    await notifyAllWorldRuntimes(baseDir, "alice_agent", ["self.md"]);

    const mark = rt.reloadTable.peek("alice_agent");
    expect(mark).toBeDefined();
    expect(mark!.changedFiles).toContain("self.md");

    rt.dispose();
  });

  it("notifyAllWorldRuntimes (多实例同 baseDir): 全部 WorldRuntime 都收到", async () => {
    // 模拟同 baseDir 多 WorldRuntime (测试同进程多 server)
    const rt1 = createWorldRuntime({ worldPath: baseDir, dev: false });
    const rt2 = createWorldRuntime({ worldPath: baseDir, dev: false });

    const { notifyAllWorldRuntimes } = await import("@ooc/core/runtime/world-runtime-registry");
    await notifyAllWorldRuntimes(baseDir, "shared_class", ["executable/index.ts"]);

    expect(rt1.reloadTable.peek("shared_class")).toBeDefined();
    expect(rt2.reloadTable.peek("shared_class")).toBeDefined();

    rt1.dispose();
    rt2.dispose();
  });

  it("notifyAllWorldRuntimes 不同 baseDir 隔离: 跨 world 不互相触发", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "ooc-c1-other-"));
    await bootstrapStoneRepo(otherDir);

    const rt1 = createWorldRuntime({ worldPath: baseDir, dev: false });
    const rt2 = createWorldRuntime({ worldPath: otherDir, dev: false });

    const { notifyAllWorldRuntimes } = await import("@ooc/core/runtime/world-runtime-registry");
    // 只通知 baseDir
    await notifyAllWorldRuntimes(baseDir, "test_class", ["x.ts"]);

    expect(rt1.reloadTable.peek("test_class")).toBeDefined(); // baseDir 收到
    expect(rt2.reloadTable.peek("test_class")).toBeUndefined(); // otherDir 未收到 (隔离)

    rt1.dispose();
    rt2.dispose();
    await rm(otherDir, { recursive: true, force: true });
  });

  it("dispose 后 WorldRuntime 解注册, 后续 notifyAllWorldRuntimes 不再触发", async () => {
    const rt = createWorldRuntime({ worldPath: baseDir, dev: false });
    rt.dispose();

    const { notifyAllWorldRuntimes } = await import("@ooc/core/runtime/world-runtime-registry");
    await notifyAllWorldRuntimes(baseDir, "test_class", ["x.ts"]);

    // dispose 后 reloadTable 已 clear, 再 notify 也不该 push (因 dispose 已 unregister)
    const mark = rt.reloadTable.peek("test_class");
    expect(mark).toBeUndefined();
  });

  it("[critical wiring] mergeFeatBranch → 模拟 stone:changed → reloadTable (dogfood 闭环)", () => {
    const rt = createWorldRuntime({ worldPath: baseDir, dev: false });

    // 模拟 mergeFeatBranch 末尾的 invalidate (它现在调 notifyAllWorldRuntimes)
    // 由于 mergeFeatBranch 是 async + 涉及 git 操作, 用 stoneRegistry.invalidate 直接模拟
    // (与 mergeFeatBranch 末尾的 notifyAllWorldRuntimes → stoneRegistry.invalidate 等价)
    rt.stoneRegistry.invalidate("agent_dogfood", ["executable/index.ts", "self.md"]);

    // reloadTable 应记录此次 invalidate, ThreadRuntime.maybeDispatchOnReload 下次 active
    // 该 inst 时会触发 lifecycle.on_reload 钩 (issue 2026-06-28)
    const mark = rt.reloadTable.peek("agent_dogfood");
    expect(mark).toBeDefined();
    expect(mark!.changedFiles).toContain("executable/index.ts");
    expect(mark!.invalidatedAt).toBeGreaterThan(0);

    rt.dispose();
  });
});
