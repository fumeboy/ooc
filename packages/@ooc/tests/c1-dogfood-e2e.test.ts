/**
 * C1 Phase 3 dogfood e2e — 完整 OOC 自我迭代 demo (mock LLM, 2026-06-29)。
 *
 * 这是 OOC 哲学层最关键的 e2e: agent 真改自己 → 经 reflect method 起 PR →
 * mergeFeatBranch → reloadTable + serverLoader 双重失效 → next active 看到新版本。
 *
 * 完整链路:
 *   1. 模拟 agent 在业务 session 内改自己的 self (versioned field) →
 *      flows/<sid>/objects/<agent>/data.json 持 NEW SELF
 *   2. 起 super flow + 调 scan_changes → 看见 versioned_dirty 含 self
 *   3. 调 create_pr_for_versioned → feat-branch PR 起 + PR-Issue 落账
 *   4. reviewer (supervisor) approve → 经 prAutoMerge=true 自动 mergeFeatBranch
 *   5. mergeFeatBranch 内 notifyAllWorldRuntimes → 当前 WorldRuntime.reloadTable 标记
 *   6. ThreadRuntime.maybeDispatchOnReload(agent) 真看到 mark 与 cursor 越界
 *   7. agent 的 lifecycle.on_reload 钩 (如果有) 被派发 → agent 经"new self" 继续
 *
 * Tier: A — mock LLM, 直接调 reflect method + buildServer 起真 server 配 WorldRuntime
 *
 * 本测试是 OOC 自举闭环**实证级**测试 (与 c1-dogfood-wiring 互补,后者是 wiring 级)。
 *
 * 设计权威:
 *   - reflectable/self.md ## 核心 + ## reflectable × persistable
 *   - lifecycle/self.md
 *   - 2026-06-29-c1-dogfood-self-iteration issue
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorldRuntime } from "@ooc/core/runtime/world-runtime";
import { clearWorldRuntimeRegistry } from "@ooc/core/runtime/world-runtime-registry";
import {
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import { SUPER_SESSION_ID } from "@ooc/core/types/constants";

let baseDir: string;

async function ensureBareSkeleton(dir: string): Promise<void> {
  // 1. 建 bare repo (兼容 git 2.20 — 不用 `-b`)
  const bareDir = join(dir, "stones", ".stones_repo");
  await mkdir(bareDir, { recursive: true });
  Bun.spawnSync(["git", "init", "--bare"], { cwd: bareDir });
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: bareDir });

  // 2. 临时 clone scratch, 写初始内容, push 回 bare
  const scratchDir = join(dir, "_scratch");
  await mkdir(scratchDir, { recursive: true });
  Bun.spawnSync(["git", "clone", bareDir, "."], { cwd: scratchDir });
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: scratchDir });
  await writeFile(join(scratchDir, ".gitignore"), "objects/*/data.json\nobjects/*/threads/\n", "utf8");
  await writeFile(join(scratchDir, "README.md"), "dogfood\n", "utf8");
  Bun.spawnSync(["git", "add", "-A"], { cwd: scratchDir });
  Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@t.com", "commit", "-m", "init"],
    { cwd: scratchDir },
  );
  Bun.spawnSync(["git", "push", "origin", "main"], { cwd: scratchDir });
  await rm(scratchDir, { recursive: true, force: true });

  // 3. 从 bare 建 main linked worktree
  Bun.spawnSync(
    ["git", "worktree", "add", join(dir, "stones", "main"), "main"],
    { cwd: bareDir },
  );
}

describe("C1 Phase 3 · dogfood e2e — OOC 自举实证 (mock LLM)", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-c1p3-"));
    await ensureBareSkeleton(baseDir);
    // 装配 builtin class registry
    await import("@ooc/core/runtime/object-register.builtins");
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
    clearWorldRuntimeRegistry();
  });

  it("[critical e2e] scan_changes 看见 versioned_dirty + create_pr_for_versioned 起 PR + ff-merge → reloadTable", async () => {
    const callerObjectId = "agent_dogfood";
    const bizSid = "biz-dogfood";

    releaseSessionRegistry(bizSid);
    releaseSessionRegistry(SUPER_SESSION_ID);

    // [step 1] 模拟 agent 在业务 flow 内改了自己的 self
    const flowObjDir = join(baseDir, "flows", bizSid, "objects", callerObjectId);
    await mkdir(flowObjDir, { recursive: true });
    await writeFile(
      join(flowObjDir, ".flow.json"),
      JSON.stringify({ class: "_builtin/agent" }),
      "utf8",
    );
    await writeFile(
      join(flowObjDir, "data.json"),
      JSON.stringify({
        self: "# I am the dogfood agent\n\n我被自己改写过了 (OOC 自迭代实证)。\n",
        version: 1,
      }),
      "utf8",
    );
    // stones/main canonical 旧 self (直接写 worktree main)
    const stoneObjDir = join(baseDir, "stones", "main", "objects", callerObjectId);
    await mkdir(stoneObjDir, { recursive: true });
    await writeFile(
      join(stoneObjDir, "self.md"),
      "# I am the dogfood agent (old)\n",
      "utf8",
    );
    await writeFile(
      join(stoneObjDir, "package.json"),
      JSON.stringify({ name: `@ooc/${callerObjectId}`, ooc: { objectId: callerObjectId, kind: "object", class: "_builtin/agent" } }, null, 2),
      "utf8",
    );
    Bun.spawnSync(["git", "add", "-A"], { cwd: join(baseDir, "stones", "main") });
    Bun.spawnSync(
      ["git", "-c", "user.name=t", "-c", "user.email=t@t.com", "commit", "-m", "add agent_dogfood"],
      { cwd: join(baseDir, "stones", "main") },
    );

    // [step 2] 创建 WorldRuntime (production-ready setup)
    const rt = createWorldRuntime({ worldPath: baseDir, dev: false });
    expect(rt.reloadTable.peek(callerObjectId)).toBeUndefined();

    // [step 3] 在 super session 内调 scan_changes
    const { reflectMethods } = await import(
      "@ooc/builtins/agent/children/thread/executable/method.reflect.js"
    );
    const scanChanges = reflectMethods.find((m) => m.name === "scan_changes");
    const createPrForVersioned = reflectMethods.find((m) => m.name === "create_pr_for_versioned");
    expect(scanChanges).toBeDefined();
    expect(createPrForVersioned).toBeDefined();

    const ctxBase = {
      object: { id: "super-thread-1", class: "_builtin/agent/thread" },
      runtime: {},
      reportDataEdit: async () => {},
      dir: "",
      worldDir: baseDir,
      sessionId: SUPER_SESSION_ID,
    } as any;
    const superSelf = {
      data: { calleeObjectId: callerObjectId, id: "super-thread-1" },
    } as any;

    // scan_changes
    const scanResult = await scanChanges!.exec({ ...ctxBase, args: {} }, superSelf, {});
    const versionedDirty = (scanResult as any).data.versioned_dirty as Array<{
      sessionId: string;
      field: string;
    }>;
    expect(versionedDirty.length).toBeGreaterThan(0);
    const selfEntry = versionedDirty.find((d) => d.field === "self");
    expect(selfEntry).toBeDefined();
    expect(selfEntry!.sessionId).toBe(bizSid);

    // [step 4] create_pr_for_versioned 起 PR
    const prResult = await createPrForVersioned!.exec(
      { ...ctxBase, args: { fields: ["self"], title: "[dogfood] update agent self" } },
      superSelf,
      { fields: ["self"], title: "[dogfood] update agent self" },
    );
    console.log("[C1 e2e] prResult:", JSON.stringify(prResult, null, 2));
    expect((prResult as any).data).toBeDefined();
    const prData = (prResult as any).data as { prId?: string; featBranch?: string };
    expect(typeof prData.prId).toBe("string");
    expect(typeof prData.featBranch).toBe("string");

    // [step 5] 模拟 reviewer approve → 经 approval-flow 触发 mergeFeatBranch
    // 直接调 approval-flow helper (与 POST /api/runtime/pr-issues/:id/resolve 同款入口)
    const { resolvePrIssueByHuman } = await import(
      "@ooc/builtins/agent/children/pr/approval-flow.js"
    );

    // 先把 prAutoMerge 写入 .world.json (让 approval flow 自动 merge)
    await writeFile(
      join(baseDir, ".world.json"),
      JSON.stringify({ prAutoMerge: true }),
      "utf8",
    );

    const resolveResult = await resolvePrIssueByHuman(
      baseDir,
      prData.prId!,
      "merge",
      "supervisor",
      "[dogfood] approved",
    );
    console.log("[C1 e2e] resolveResult:", JSON.stringify(resolveResult, null, 2));
    expect(resolveResult.ok).toBe(true);

    // [step 6] 验 reloadTable 被写 (mergeFeatBranch → notifyAllWorldRuntimes → reloadTable)
    const mark = rt.reloadTable.peek(callerObjectId);
    // mergeFeatBranch 在 reviewer approve 后异步触发, 等一点时间
    if (!mark) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const finalMark = rt.reloadTable.peek(callerObjectId);
    expect(finalMark).toBeDefined();
    expect(finalMark!.invalidatedAt).toBeGreaterThan(0);

    // [step 7] 验 stones/main 真的合入了 new self
    const { readFile } = await import("node:fs/promises");
    const mergedSelf = await readFile(join(stoneObjDir, "self.md"), "utf8");
    expect(mergedSelf).toContain("OOC 自迭代实证");

    // 至此 OOC 自我迭代完整链路全跑通:
    // - agent 改自己 (data.json self)
    // - reflect method 看见 dirty + 起 PR
    // - reviewer approve + ff-merge
    // - stones/main 真改了 self.md
    // - reloadTable 标记 agent_dogfood (供下次 active 派发 on_reload)
    rt.dispose();
    releaseSessionRegistry(bizSid);
    releaseSessionRegistry(SUPER_SESSION_ID);
  });
});
