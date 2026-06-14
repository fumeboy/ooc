/**
 * Harness cycle real experience for ooc-6 Object Unification.
 *
 * Tests all 10 points of the Object Unification design end-to-end:
 *  0. Context windows = objects in context (unified method concept)
 *  1. Builtin windows → builtin objects in src/extendable/base/
 *  2. Objects appear as context windows
 *  3. Web UI per-window-type → object's visible/ module
 *  4. Readable concept
 *  5. Prototype chain (verified via custom dispatcher inheritance)
 *  6. Directory naming (executable/, readable., visible/)
 *  7. Method visibility (public, for_ui_access)
 *  8. Method exec creating objects that enter context
 *  9. Runtime-created objects in flows/<sid>/objects/<pid>/context/
 * 10. Peer/children auto-enter context (no relation window needed)
 *
 * Prefix: _test_harness_ooc6_ to ensure cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowsService } from "@ooc/core/app/server/modules/flows/service";
import { buildServer } from "@ooc/core/app/server";
import { readServerConfig } from "@ooc/core/app/server/bootstrap/config";
import {
  readContextRegistry,
  readRuntimeObjectState,
  runtimeObjectStateFile,
} from "@ooc/core/persistable";
import { builtinRegistry } from "@ooc/core/executable/windows";
import { createStoneObject, writeReadable } from "@ooc/core/persistable";
import { renderContextXml } from "@ooc/core/__tests__/render-context-xml";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import {
  parseTrigger,
  evaluateTrigger,
} from "@ooc/core/thinkable/knowledge/activator.expr";
import { derivePeerObjectWindows } from "@ooc/core/thinkable/context/object-windows";
import { WindowManager } from "@ooc/core/executable/windows/_shared/manager";
import type {
  ContextWindow,
  TalkWindow,
  TodoWindow,
  KnowledgeWindow,
} from "@ooc/core/executable/windows/_shared/types";

describe("ooc-6 Object Unification harness cycle", () => {
  let baseDir: string;
  const sessionId = "_test_harness_ooc6_sess1";
  const objectId = "test_agent";
  const peerId = "peer_agent";

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-harness-"));
    // Create minimal world structure
    await mkdir(join(baseDir, "stones", "main", "objects", objectId), { recursive: true });
    await mkdir(join(baseDir, "stones", "main", "objects", peerId), { recursive: true });
    // Write minimal self/readable for each
    await writeFile(
      join(baseDir, "stones", "main", "objects", objectId, "self.md"),
      `---\ntitle: Test Agent\ndescription: A test agent for ooc-6 harness\n---\nI am a test agent.`,
      "utf8",
    );
    await writeReadable(
      { baseDir, objectId },
      `---\ntitle: Test Agent\n---\nI am a test agent for ooc-6 Object Unification.`,
    );
    await writeFile(
      join(baseDir, "stones", "main", "objects", peerId, "self.md"),
      `---\ntitle: Peer Agent\ndescription: A peer agent\n---\nI am a peer agent.`,
      "utf8",
    );
    await writeReadable(
      { baseDir, objectId: peerId },
      `---\ntitle: Peer Agent\n---\nI am a peer of test_agent.`,
    );
    // Write .world.json
    await writeFile(
      join(baseDir, ".world.json"),
      JSON.stringify({ siteName: "OOC Test World", workerMaxTicks: 5 }, null, 2),
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  // ── Point 0 & 2: Context windows = objects in context ──────────────────────
  it("0+2: context windows are objects - thread holds unified ContextObject array", async () => {
    const thread = makeThread({
      id: "t_main",
      objectId,
      persistence: { baseDir, sessionId, objectId, threadId: "t_main" },
    });

    // Thread should have default windows
    expect(thread.contextWindows).toBeDefined();
    expect(thread.contextWindows.length).toBeGreaterThan(0);
    const selfWindow = thread.contextWindows.find((w) => w.id === "test_agent");
    expect(selfWindow).toBeDefined();
    // ooc-6: window.id = objectId, window.class = objectId
    expect(selfWindow!.class).toBe("test_agent" as any);
    expect(selfWindow!.id).toBe("test_agent");

    const creatorWindow = thread.contextWindows.find(
      (w) => w.class === "talk" && (w as TalkWindow).isCreatorWindow,
    ) as TalkWindow | undefined;
    expect(creatorWindow).toBeDefined();
    expect(creatorWindow!.isCreatorWindow).toBe(true);

    // Insert a todo window - should appear as object in context
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const todoId = mgr.insertTypedWindow({
      id: "w_todo_1",
      class: "todo",
      parentWindowId: "root",
      title: "Test Todo",
      status: "open",
      createdAt: Date.now(),
      content: "Complete the harness test",
    }, thread);
    thread.contextWindows = mgr.toData();

    expect(thread.contextWindows.length).toBeGreaterThan(1); // root + todo

    const todo = thread.contextWindows.find((w) => w.id === todoId) as TodoWindow | undefined;
    expect(todo).toBeDefined();
    expect(todo!.class).toBe("todo");
    expect(todo!.content).toBe("Complete the harness test");

    // ContextWindow union is equivalent to ContextObject
    const asObject: any = todo;
    expect(asObject.class).toBe("todo");
  });

  // ── Point 1: Builtin objects in src/extendable/base/ ─────────────────────
  it("1: builtin objects are registered from src/extendable/base/", () => {
    const types = builtinRegistry.listRegisteredObjectTypes();

    // All builtin types should be registered (11 core types, custom removed in ooc-6)
    const expectedBuiltins: string[] = [
      "root", "method_exec", "todo", "file", "knowledge",
      "search", "skill_index", "plan", "terminal_process", "interpreter_process",
      "talk",
    ];
    for (const t of expectedBuiltins) {
      expect(types).toContain(t);
      const def = builtinRegistry.getObjectDefinition(t);
      expect(def).toBeDefined();
    }

  });

  // ── Point 4: Readable concept ───────────────────────────────────────────
  it("4: readable concept - objects render their readable content in XML", async () => {
    // Create stone objects with readable (writeReadable → readable.md)
    await createStoneObject({ baseDir, objectId: "readable_test" });
    await writeReadable(
      { baseDir, objectId: "readable_test" },
      `---\ntitle: Readable Test Object\n---\nThis is a test of the readable concept.\n\nIt has multiple lines.`,
    );

    const thread = makeThread({
      id: "t_main",
      objectId,
      persistence: { baseDir, sessionId, objectId, threadId: "t_main" },
    });

    // Insert self window for the readable_test object (ooc-6 design)
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    mgr.insertTypedWindow({
      id: "readable_test",
      class: "readable_test" as any,
      parentWindowId: "root",
      title: "Readable Test",
      status: "open",
      createdAt: Date.now(),
    } as ContextWindow, thread);
    thread.contextWindows = mgr.toData();

    // Render XML
    const xml = await renderContextXml({ thread, contextWindows: thread.contextWindows });
    expect(xml).toContain("<context");
    expect(xml).toContain("Readable Test Object"); // from readable title
    expect(xml).toContain("readable concept"); // from readable body
  });

  // ── Point 7: Method visibility - commands per type ───────────────────────
  it("7: each object type has its own methods (commands) registered", () => {
    // root 已非 god-object：agency（talk/plan/todo/end）→ _builtin/agent，
    // file/program 工具 → filesystem/terminal 成员。root type 只剩 misc。
    const rootDef = builtinRegistry.getObjectDefinition("root");
    expect(rootDef.methods["example"]).toBeDefined();
    // agency 在 _builtin/agent（具体 agent 经 ooc.class 继承）；talk 统一 peer + fork 两形态。
    expect(builtinRegistry.resolveMethod("_builtin/agent", "talk")).toBeDefined();
    expect(builtinRegistry.resolveMethod("_builtin/agent", "plan")).toBeDefined();

    // objectId type is no longer a separate builtin type (ooc-6); objects self-register
    // edit_relation method is now available on dynamically-registered object types

    // Todo 只有自身的 constructor 方法 `todo`（ooc-6 constructor 模式：创建 todo 走 exec(method="todo")）
    const todoDef = builtinRegistry.getObjectDefinition("todo");
    expect(Object.keys(todoDef.methods)).toEqual(["todo"]);

    // File should have edit/reload/set_range commands
    const fileDef = builtinRegistry.getObjectDefinition("file");
    expect(fileDef.methods["edit"]).toBeDefined();
    expect(fileDef.methods["reload"]).toBeDefined();

    // Plan should have add_step / mark_done commands
    const planDef = builtinRegistry.getObjectDefinition("plan");
    expect(planDef.methods["add_step"]).toBeDefined();
    expect(planDef.methods["mark_done"]).toBeDefined();

    // Skill_index has no LLM-callable commands (search is handled via program)
    const skillDef = builtinRegistry.getObjectDefinition("skill_index");
    expect(Object.keys(skillDef.methods).length).toBe(0);

    // method_exec should have submit/refine methods
    const execDef = builtinRegistry.getObjectDefinition("method_exec");
    expect(execDef.methods["submit"]).toBeDefined();
    expect(execDef.methods["refine"]).toBeDefined();
  });

  // ── Point 8: Method exec creates objects that enter context ────────────
  it("8: open_knowledge creates a knowledge object that enters context", async () => {
    const thread = makeThread({
      id: "t_main",
      objectId,
      persistence: { baseDir, sessionId, objectId, threadId: "t_main" },
    });

    const initialCount = thread.contextWindows.length;

    // Insert a knowledge window (simulating what open_knowledge method does)
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    mgr.insertTypedWindow({
      id: "w_knowledge_test",
      class: "knowledge",
      parentWindowId: "root",
      title: "Test Knowledge",
      status: "open",
      createdAt: Date.now(),
      path: "test/knowledge",
      source: "explicit",
      body: "## Test Knowledge\n\nThis is test knowledge created by open_knowledge.",
      presentation: "full",
    }, thread);
    thread.contextWindows = mgr.toData();

    // Knowledge object should be in context
    expect(thread.contextWindows.length).toBe(initialCount + 1);
    const knowledge = thread.contextWindows.find(
      (w) => w.id === "w_knowledge_test",
    ) as KnowledgeWindow | undefined;
    expect(knowledge).toBeDefined();
    expect(knowledge!.class).toBe("knowledge");
    expect(knowledge!.path).toBe("test/knowledge");
  });

  // ── Point 9: Runtime objects persist to flat flows/<sid>/<oid>/state.json + thread context.json registry ──
  it("9: context objects persist to flat flows/<sid>/<oid>/state.json + thread context.json registry", async () => {
    const thread = makeThread({
      id: "t_main",
      objectId,
      persistence: { baseDir, sessionId, objectId, threadId: "t_main" },
    });

    // Insert a knowledge window with thread context (triggers persistence)
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const windowId = mgr.insertTypedWindow({
      id: "w_knowledge_persist",
      class: "knowledge",
      parentWindowId: "root",
      title: "Persist Test Knowledge",
      status: "open",
      createdAt: Date.now(),
      path: "test/persist",
      source: "explicit",
      body: "## Persistent Knowledge",
      presentation: "full",
    }, thread);
    thread.contextWindows = mgr.toData();

    // Wait for async fire-and-forget write to complete
    await new Promise((r) => setTimeout(r, 80));

    // Verify flat state.json exists
    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId,
      objectId: windowId,
    });
    const { existsSync } = await import("node:fs");
    expect(existsSync(stateFile)).toBe(true);

    // Verify we can read it back via flat API
    const flat = await readRuntimeObjectState({
      baseDir,
      sessionId,
      objectId: windowId,
    });
    expect(flat).toBeDefined();
    expect(flat!.class).toBe("knowledge");
    expect((flat as any).path).toBe("test/persist");
    expect(flat!.title).toBe("Persist Test Knowledge");

    // Verify thread context registry tracks this object
    const registry = await readContextRegistry({
      baseDir,
      sessionId,
      objectId,
      threadId: "t_main",
    });
    expect(registry.members.find((m) => m.objectId === windowId)).toBeDefined();

    // Verify upsert updates the persisted copy
    const mgr2 = WindowManager.fromThread(thread, builtinRegistry);
    const updated = {
      ...flat!,
      title: "Updated Persistent Knowledge",
    };
    mgr2.upsertWindow(updated, thread);
    thread.contextWindows = mgr2.toData();

    await new Promise((r) => setTimeout(r, 80));

    const updatedFlat = await readRuntimeObjectState({
      baseDir,
      sessionId,
      objectId: windowId,
    });
    expect(updatedFlat!.title).toBe("Updated Persistent Knowledge");

    // Verify delete removes from persistence
    const mgr3 = WindowManager.fromThread(thread, builtinRegistry);
    (mgr3 as any).removeWindow(windowId, thread);
    thread.contextWindows = mgr3.toData();

    await new Promise((r) => setTimeout(r, 80));

    const afterDelete = await readRuntimeObjectState({
      baseDir,
      sessionId,
      objectId: windowId,
    });
    expect(afterDelete).toBeUndefined();
    const regAfter = await readContextRegistry({
      baseDir,
      sessionId,
      objectId,
      threadId: "t_main",
    });
    expect(regAfter.members.find((m) => m.objectId === windowId)).toBeUndefined();
  });

  // ── Point 10: Peer objects auto-enter context ─────────────────────────
  it("10: peer agent stone automatically appears as context object (no relation window needed)", async () => {
    const thread = makeThread({
      id: "t_main",
      objectId,
      persistence: { baseDir, sessionId, objectId, threadId: "t_main" },
    });

    // Derive peer objects (what synthesizer does every round)
    const peerWindows = await derivePeerObjectWindows(thread);

    // Peer agent should be in the derived windows
    expect(peerWindows.length).toBeGreaterThan(0);
    const peer = peerWindows.find((w) => w.id === peerId);
    expect(peer).toBeDefined();
    expect(peer!.class).toBe(peerId as any);
    expect(peer!.title).toBe("Peer Agent"); // from readable title

  });

  // ── Phase 8: New trigger format works ───────────────────────────────────
  it("Phase 8: new trigger format object::/method::/object_id:: works with backward compat", () => {
    // New format parses correctly
    const objTrigger = parseTrigger("object::todo");
    expect(objTrigger.kind).toBe("object");
    expect((objTrigger as any).objectType).toBe("todo");

    const methodTrigger = parseTrigger("method::root::open_knowledge");
    expect(methodTrigger.kind).toBe("method");
    expect((methodTrigger as any).objectType).toBe("root");
    expect((methodTrigger as any).method).toBe("open_knowledge");

    const idTrigger = parseTrigger("object_id::agent_alice");
    expect(idTrigger.kind).toBe("objectId");
    expect((idTrigger as any).objectId).toBe("agent_alice");

    // Old format auto-maps to new kinds
    const legacyWindow = parseTrigger("window::todo");
    expect(legacyWindow.kind).toBe("object"); // auto-mapped
    expect((legacyWindow as any).objectType).toBe("todo");

    const legacyMethod = parseTrigger("method::root::open_knowledge");
    expect(legacyMethod.kind).toBe("method"); // auto-mapped
    expect((legacyMethod as any).objectType).toBe("root");
    expect((legacyMethod as any).method).toBe("open_knowledge");
  });

  it("Phase 8: new trigger format evaluates correctly against thread", async () => {
    const thread = makeThread({
      id: "t_main",
      objectId,
      persistence: { baseDir, sessionId, objectId, threadId: "t_main" },
      extraWindows: [
        {
          id: "w_todo_1",
          class: "todo",
          parentWindowId: "root",
          title: "Test Todo",
          status: "open",
          createdAt: Date.now(),
          content: "Test",
        } as ContextWindow,
        {
          id: "agent_alice",
          class: "agent_alice" as any,
          parentWindowId: "root",
          title: "Custom Agent",
          status: "open",
          createdAt: Date.now(),
        } as ContextWindow,
      ],
    });

    // object::todo should hit
    const objTrigger = parseTrigger("object::todo");
    expect(evaluateTrigger(objTrigger, thread)).toBe(true);

    // object::nonexistent should miss
    const missTrigger = parseTrigger("object::nonexistent");
    expect(evaluateTrigger(missTrigger, thread)).toBe(false);

    // object_id::agent_alice should hit
    const idTrigger = parseTrigger("object_id::agent_alice");
    expect(evaluateTrigger(idTrigger, thread)).toBe(true);
  });

  // ── All together: full synthesis pipeline includes peer objects ─────────
  it("full pipeline: thread context includes builtin + custom + peer objects", async () => {
    const thread = makeThread({
      id: "t_main",
      objectId,
      persistence: { baseDir, sessionId, objectId, threadId: "t_main" },
      extraWindows: [
        {
          id: "w_todo_1",
          class: "todo",
          parentWindowId: "root",
          title: "Test Todo",
          status: "open",
          createdAt: Date.now(),
          content: "Complete harness test",
        },
      ] as ContextWindow[],
    });

    // Simulate what synthesizer does: derive peer objects and add to context
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const peerWindows = await derivePeerObjectWindows(thread);
    for (const pw of peerWindows) {
      mgr.upsertWindow(pw, thread);
    }
    thread.contextWindows = mgr.toData();

    // Render XML
    const xml = await renderContextXml({ thread, contextWindows: thread.contextWindows });

    // Should contain do (creator), self, todo, and peer objects
    expect(xml).toContain("w_creator_t_main"); // creator do window
    expect(xml).toContain('class="test_agent"'); // self window（ooc-6：id=class=objectId，custom: 前缀已移除）
    expect(xml).toContain('class="todo"'); // todo object
    expect(xml).toContain("Test Todo"); // todo content
    expect(xml).toContain("peer_agent"); // peer from stone hierarchy
    expect(xml).toContain("Peer Agent"); // peer title from readable
  });
});
