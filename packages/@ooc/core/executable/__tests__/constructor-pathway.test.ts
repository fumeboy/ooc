/**
 * Constructor pathway end-to-end integration test.
 *
 * Verifies the constructor contract holds across persistence + dispatch:
 *   1. Builtin feature constructor (talk) → object inlined into thread-context.json,
 *      NO independent `<oid>/` dir, parent state.json has no contextWindows.
 *   2. Independent flow object constructor (plan) → own dir with `.flow.json:class === "plan"`
 *      + state.json (no contextWindows), and a `_ref` entry in parent thread-context.json.
 *   3. reportStateEdit(ref) on independent object → state.json on disk reflects in-memory mutation.
 *   4. reportContextEdit(thread) → thread-context.json reflects in-memory contextWindows.
 *   5. createFlowObject({ class: "no-such-class" }) → ClassNotFoundError.
 *   6. resolveMethod walks parentClass chain (smoke check via dispatch): a stub class with
 *      parentClass: "root" can dispatch root method "talk" successfully (constructor returns ok+object).
 *   7. self.class mismatch → manager rejects dispatch (a method registered on class X cannot run when
 *      self.class === Y, with X not in Y's chain).
 *
 * Side-effect imports load builtins/root + core windows so the registry has full state
 * (talk/do/plan/... constructors registered, `lookupConstructor` and `resolveMethod` chains work).
 */

// Side-effect imports — register all builtin/core types into the object registry.
import "@ooc/builtins/root/executable/index.js";
import "@ooc/core/runtime/register-builtins.js";
import "@ooc/builtins/agent/plan";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WindowManager } from "../manager";
import { makeThread } from "../../../../__tests__/make-thread";
import { ROOT_WINDOW_ID, type MethodExecWindow, type ContextWindow } from "../types";
import {
  ClassNotFoundError,
  createFlowObject,
  createFlowSession,
  createStoneObject,
  flowMetadataFile,
  runtimeObjectStateFile,
  __resetSerialQueueForTests,
} from "../../../../persistable";
import { readThreadContext, threadContextFile } from "@ooc/builtins/agent/thread/persistable/flow-thread-context";
import type { FlowObjectRef, ThreadPersistenceRef } from "../../../../persistable/common";
import type { ThreadContext } from "../../../../thinkable/context";
import type { PlanWindow } from "@ooc/builtins/agent/plan/types.js";
import { dispatchToolCall } from "../../../tools";
import { builtinRegistry } from "../registry";

/**
 * agency 方法（talk/plan/...）已从 root 迁到 `_builtin/agent` 类。
 * 经 dispatch 调 agency 时须把 parentWindowId 指向一个 class 解析得到 `_builtin/agent` 的窗。
 */
const AGENT_WIN = {
  id: "agent",
  class: "_builtin/agent",
  parentWindowId: ROOT_WINDOW_ID,
  title: "agent",
  status: "open",
  createdAt: Date.now(),
  isMemberWindow: true,
  // class="_builtin/agent" 是继承类、非 ContextWindow union discriminant → 经 unknown 转。
} as unknown as ContextWindow;

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Poll for a predicate so we don't race the serial-queue flush. */
async function waitFor(check: () => Promise<boolean>, attempts = 40, delayMs = 25): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await Bun.sleep(delayMs);
  }
}

describe("constructor pathway integration", () => {
  let baseDir: string;
  let persistence: ThreadPersistenceRef;
  let thread: ThreadContext;

  beforeEach(async () => {
    __resetSerialQueueForTests();
    baseDir = await mkdtemp(join(tmpdir(), "ooc-p6-ctorpath-"));
    persistence = {
      baseDir,
      sessionId: "sess_p6_ctor",
      objectId: "agent_owner",
      threadId: "t_main",
    };
    // Set up real flow-object dirs so the manager has somewhere to write.
    await createFlowSession(baseDir, persistence.sessionId);
    // Stone object for the owner so talk target / parent flow-object resolves cleanly.
    await createStoneObject({ baseDir, objectId: persistence.objectId });
    // Stone object that can serve as a `talk.target` (talk constructor checks stones/<target>/).
    await createStoneObject({ baseDir, objectId: "peer_alice" });
    // Parent flow-object dir (so persistObjectAfterChange can write under it).
    await createFlowObject({
      baseDir,
      sessionId: persistence.sessionId,
      objectId: persistence.objectId,
    });
    thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true, extraWindows: [AGENT_WIN] });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  // ─── Test 1: builtin feature constructor (talk) → inlined into thread-context.json ──
  test("Test 1: talk constructor inlines into thread-context.json (no own dir, no contextWindows on parent state)", async () => {
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    // Drive the builtin feature via the auto-submit path on root.talk.
    const opened = await mgr.openMethodExec({
      thread,
      parentWindowId: "agent",
      method: "talk",
      title: "open talk to peer",
      args: { target: "peer_alice", title: "hi alice" },
    });
    // Constructor returned ok+object → manager.submit auto-mounts via insertTypedWindow.
    expect(opened.autoSubmitted).toBe(true);
    const result = opened.submitResult ?? "";
    expect(result.startsWith("[")).toBe(false); // no error prefix

    // Find the newly-mounted talk_window in mgr.
    const talkWindow = mgr.list().find((w) => w.class === "talk");
    expect(talkWindow).toBeDefined();

    // Wait for thread-context.json flush.
    const tcFile = threadContextFile(persistence);
    await waitFor(async () => exists(tcFile));
    expect(await exists(tcFile)).toBe(true);

    const file = await readThreadContext(persistence);
    expect(file).not.toBeNull();
    const inlineEntry = file!.contextWindows.find((e) => e.id === talkWindow!.id);
    expect(inlineEntry).toBeDefined();
    // builtin feature → completely inlined, NOT a `_ref` entry
    expect((inlineEntry as { _ref?: boolean })._ref).toBeUndefined();
    // talk-family class is a POV projection (context.md core 7): NOT persisted on disk;
    // recomputed at read by computeProjectionClass. In-memory window still carries class="talk".
    expect((inlineEntry as { class?: string }).class).toBeUndefined();
    expect(talkWindow!.class).toBe("talk");
    expect((inlineEntry as { target?: string }).target).toBe("peer_alice");

    // No independent dir for the talk_window
    const talkDir = join(baseDir, "flows", persistence.sessionId, talkWindow!.id);
    expect(await exists(talkDir)).toBe(false);
    const talkStateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: persistence.sessionId,
      objectId: talkWindow!.id,
    });
    expect(await exists(talkStateFile)).toBe(false);

    // Parent (owner) state.json — written for the parent owner if at all — must not contain contextWindows.
    const ownerStateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: persistence.sessionId,
      objectId: persistence.objectId,
    });
    if (await exists(ownerStateFile)) {
      const ownerRaw = JSON.parse(await readFile(ownerStateFile, "utf8")) as Record<string, unknown>;
      expect("contextWindows" in ownerRaw).toBe(false);
    }
  });

  // ─── Test 1b: self facade window (id=objectId) 不落 thread-context.json（死 _ref 刷屏根治）──
  test("Test 1b: self facade window (isSelfWindow) 被排除出 thread-context.json", async () => {
    // 模拟 initContextWindows 注入的 self 门面窗（id=type=objectId，标记 isSelfWindow）。
    const selfWin = {
      id: persistence.objectId,
      class: persistence.objectId,
      parentWindowId: ROOT_WINDOW_ID,
      title: persistence.objectId,
      status: "open",
      createdAt: Date.now(),
      isSelfWindow: true,
    } as ContextWindow;
    thread.contextWindows = [selfWin, ...(thread.contextWindows ?? [])];

    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    // 任意 builtin feature 写都会触发 writeThreadContextSnapshot（遍历所有 window）。
    await mgr.openMethodExec({
      thread,
      parentWindowId: "agent",
      method: "talk",
      title: "trigger ctx flush",
      args: { target: "peer_alice", title: "hi" },
    });

    const tcFile = threadContextFile(persistence);
    await waitFor(async () => exists(tcFile));
    const file = await readThreadContext(persistence);
    expect(file).not.toBeNull();
    // self 门面窗既不作为 inline 也不作为 _ref 出现（否则 reload 找 <objectId>/state.json 死 ref 刷屏）。
    const selfEntry = file!.contextWindows.find(
      (e) => e.id === persistence.objectId ||
        (e as { refObjectId?: string }).refObjectId === persistence.objectId,
    );
    expect(selfEntry).toBeUndefined();
  });

  // ─── Test 2: independent flow object constructor (plan) → own dir + state.json + ref ──
  test("Test 2: plan constructor writes own dir + .flow.json:class=\"plan\" + state.json + thread context ref", async () => {
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const opened = await mgr.openMethodExec({
      thread,
      parentWindowId: "agent",
      method: "plan",
      title: "make a plan",
      args: { plan: "do the thing" },
    });
    expect(opened.autoSubmitted).toBe(true);
    const result = opened.submitResult ?? "";
    expect(result.startsWith("[")).toBe(false);

    const planWindow = mgr.list().find((w) => w.class === "plan") as PlanWindow | undefined;
    expect(planWindow).toBeDefined();
    const planId = planWindow!.id;

    // Wait for own-dir state.json + thread-context.json to flush.
    const planStateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: persistence.sessionId,
      objectId: planId,
    });
    const planFlowFile = flowMetadataFile({
      baseDir,
      sessionId: persistence.sessionId,
      objectId: planId,
    });
    const tcFile = threadContextFile(persistence);
    await waitFor(async () => (await exists(planStateFile)) && (await exists(planFlowFile)) && (await exists(tcFile)));

    expect(await exists(planFlowFile)).toBe(true);
    const flowMeta = JSON.parse(await readFile(planFlowFile, "utf8")) as { class?: string; type?: string };
    expect(flowMeta.type).toBe("flow-object");
    expect(flowMeta.class).toBe("plan");

    expect(await exists(planStateFile)).toBe(true);
    const planState = JSON.parse(await readFile(planStateFile, "utf8")) as Record<string, unknown>;
    expect(planState.id).toBe(planId);
    expect(planState.class).toBe("plan");
    // state.json must NOT carry contextWindows (object dimension only).
    expect("contextWindows" in planState).toBe(false);

    // Thread context.json must contain a `_ref` pointing at the plan, not the inline plan body.
    const file = await readThreadContext(persistence);
    expect(file).not.toBeNull();
    const refEntry = file!.contextWindows.find((e) => e.id === planId);
    expect(refEntry).toBeDefined();
    expect((refEntry as { _ref?: boolean })._ref).toBe(true);
    expect((refEntry as { refObjectId?: string }).refObjectId).toBe(planId);
    expect((refEntry as { class: string }).class).toBe("plan");
  });

  // ─── Test 3: reportStateEdit on independent object → state.json reflects mutation ──
  test("Test 3: reportStateEdit(ref) on plan flushes in-memory mutation to state.json", async () => {
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const plan: PlanWindow = {
      id: "plan_edit_target",
      class: "plan",
      parentWindowId: ROOT_WINDOW_ID,
      title: "before",
      status: "active",
      createdAt: 1,
      description: "v1",
      steps: [],
    };
    mgr.insertTypedWindow(plan, thread);

    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: persistence.sessionId,
      objectId: plan.id,
    });
    await waitFor(async () => exists(stateFile));
    expect(await exists(stateFile)).toBe(true);

    // Mutate in memory then call reportStateEdit.
    const mutated: PlanWindow = { ...plan, description: "v2-after-edit", title: "after" };
    mgr.upsertWindow(mutated);
    const ref: FlowObjectRef = {
      baseDir,
      sessionId: persistence.sessionId,
      objectId: plan.id,
    };
    await mgr.reportStateEdit(ref);

    const onDisk = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>;
    expect(onDisk.description).toBe("v2-after-edit");
    expect(onDisk.title).toBe("after");
    expect("contextWindows" in onDisk).toBe(false);
  });

  // ─── Test 4: reportContextEdit on thread → thread-context.json reflects current windows ──
  test("Test 4: reportContextEdit(thread) flushes in-memory contextWindows to thread-context.json", async () => {
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const plan: PlanWindow = {
      id: "plan_ctx_target",
      class: "plan",
      parentWindowId: ROOT_WINDOW_ID,
      title: "demo",
      status: "active",
      createdAt: 1,
      description: "for context flush",
      steps: [],
    };
    mgr.insertTypedWindow(plan, thread);

    const tcFile = threadContextFile(persistence);
    await waitFor(async () => exists(tcFile));
    expect(await exists(tcFile)).toBe(true);

    // Force a fresh flush via reportContextEdit and re-read.
    await mgr.reportContextEdit(thread);
    const file = await readThreadContext(persistence);
    expect(file).not.toBeNull();
    expect(file!.threadId).toBe("t_main");
    const refEntry = file!.contextWindows.find((e) => e.id === plan.id);
    expect(refEntry).toBeDefined();
    // independent flow object → ref entry, not inline
    expect((refEntry as { _ref?: boolean })._ref).toBe(true);
  });

  // ─── Test 5: ClassNotFoundError when class is unregistered ──────────────────────
  test("Test 5: createFlowObject with unregistered class throws ClassNotFoundError", async () => {
    let caught: unknown;
    try {
      await createFlowObject(
        { baseDir, sessionId: persistence.sessionId, objectId: "ghost_obj" },
        { class: "definitely-not-a-real-class" },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClassNotFoundError);
    const err = caught as ClassNotFoundError;
    expect(err.code).toBe("CLASS_NOT_FOUND");
    expect(err.classId).toBe("definitely-not-a-real-class");
  });

  // ─── Test 6: resolveMethod chain — stub class with parentClass: "root" inherits "example" ─
  // (agency talk/do/... 已迁到 _builtin/agent，open_knowledge/create_object 迁到成员对象；
  //  这里改用仍挂在 root 上的 `example` 验证同一条 parentClass 链解析机制 —— 断言形态不变。)
  test("Test 6: stub class with parentClass=\"root\" resolves \"example\" via chain (smoke check at dispatch lookup)", async () => {
    // Register a brand-new string that defaults to inheriting from root.
    const stubType = `__test_stub_inherits_root_${Date.now()}`;
    builtinRegistry.registerNewObjectType(stubType as never, {
      methods: {},
      readable: () => [],
      // undefined parentClass → defaults to "root" per resolveMethod
    });

    // 1. Registry-level chain walk finds `example` on root (a root-declared method).
    const resolved = builtinRegistry.resolveMethod(stubType, "example");
    expect(resolved).toBeDefined();
    expect(resolved!.description).toBeTruthy();

    // 2. Manager-level dispatch lookup finds the same entry — declaringType is the ancestor (root)
    //    where the method is declared. This is the wiring that submit() consults.
    const entry = builtinRegistry.lookupMethodEntry({ class: stubType as never }, "example");
    expect(entry).toBeDefined();
    expect(entry!.declaringType).toBe("root");
    expect(entry!.entry.kind).toBeUndefined(); // root.example is a plain method

    // 3. End-to-end dispatch via openMethodExec on a stub-typed parent — verifies the wiring reaches
    //    exec. `example` has no onFormChange → fast-path execDirect → returns directResult (no form).
    //    The mere fact openMethodExec returned (rather than throwing the "method not registered"
    //    error at the lookup gate) proves the dispatch lookup walked the parentClass chain to root.
    const stubParent = {
      id: `w_stub_${Date.now()}`,
      class: stubType as never,
      parentWindowId: ROOT_WINDOW_ID,
      title: "stub parent",
      status: "active",
      createdAt: Date.now(),
    };
    thread.contextWindows = [stubParent as unknown as ContextWindow];
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const opened = await mgr.openMethodExec({
      thread,
      parentWindowId: stubParent.id,
      method: "example",
      title: "stub opens example",
      args: {},
    });
    // Lookup succeeded (would throw otherwise) → chain walk reached root. example auto-execs.
    expect(opened.autoSubmitted).toBe(true);
    expect(opened.directResult).toBeDefined();
  });

  // ─── Test 7: self.class mismatch — method declared on X cannot run when self.class === Y ─
  test("Test 7: self.class mismatch — manager rejects dispatch (method not in self's class chain)", async () => {
    // Register a stub class with parentClass:null (no inheritance) and an own method "stub_only".
    // Then put that method's form on a DIFFERENT parent.class ("plan") — plan doesn't have "stub_only"
    // in its chain (plan inherits from root, not from stubX).
    const stubType = `__test_isolated_${Date.now()}`;
    builtinRegistry.registerNewObjectType(stubType as never, {
      methods: {
        stub_only: {
          description: "stub-only test method",
          intents: ["stub_only"],
          permission: () => "allow",
          exec: async () => ({ ok: true, result: "should not get here" }),
        },
      },
      parentClass: null, // no inheritance — stub_only lives ONLY on this stub type
      readable: () => [],
    });

    // Create an actual plan_window in the thread (the "wrong" parent type for stub_only).
    const planWindow: PlanWindow = {
      id: "plan_isolation_target",
      class: "plan",
      parentWindowId: ROOT_WINDOW_ID,
      title: "isolation target",
      status: "active",
      createdAt: Date.now(),
      description: "for self-type guard test",
      steps: [],
    };
    thread.contextWindows = [planWindow];
    const mgr = WindowManager.fromThread(thread, builtinRegistry);

    // openMethodExec will refuse to register the form because lookupMethodEntry can't find
    // "stub_only" on plan's chain (plan → root → null, neither has stub_only).
    let caught: Error | undefined;
    try {
      await mgr.openMethodExec({
        thread,
        parentWindowId: planWindow.id,
        method: "stub_only",
        title: "wrong parent",
      });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("not registered on window");
    expect(caught!.message).toContain("plan");
  });
});
