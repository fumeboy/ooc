/**
 * issue J 新增 tests:
 *  - ref.window_view 字段 round-trip（construct / serialize / deserialize）
 *  - thread.construct self-view ref 显式 window_view="self"
 *  - createSuperThread self-view ref 显式 window_view="super"
 *  - resolveWindowView / resolveDefaultWindowView 命名生效
 *  - computeProjectionClass fallback warning（NODE_ENV !== 'production' 时触发）
 *  - RuntimeHandle.instantiate args windowView 透传 ref.window_view
 *  - refIdentity helper 剥离 window_view
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  builtinClassRegistry,
  getSessionRegistry,
  releaseSessionRegistry,
  DEFAULT_WINDOW_VIEW,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { threadWindowIdOf, refIdentity } from "@ooc/core/types/context-window";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants";
import { computeProjectionClass } from "@ooc/builtins/agent/children/thread/readable/index";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class";

const SESSION = "test-window-view-issueJ";

async function makeThread(sessionId: string): Promise<ThreadContext> {
  const reg = getSessionRegistry(sessionId);
  const ctor = reg.resolveConstructor(THREAD_CLASS_ID)!;
  const data = (await ctor.exec(
    { sessionId, worldDir: "", dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
    { calleeObjectId: "_builtin/supervisor", message: "hi" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: THREAD_CLASS_ID, data });
  return data;
}

describe("issue J: OocObjectRef.window_view + naming rename", () => {
  beforeEach(() => releaseSessionRegistry(SESSION));
  afterEach(() => releaseSessionRegistry(SESSION));

  describe("ref.window_view 字段 round-trip", () => {
    it("OocObjectRef 接受 window_view optional 字段且 JSON round-trip 保留", () => {
      const ref: OocObjectRef = {
        id: "x",
        class: "_test/c",
        window_view: "custom_view",
        createdAt: 0,
      };
      const json = JSON.stringify(ref);
      const back = JSON.parse(json) as OocObjectRef;
      expect(back.window_view).toBe("custom_view");
      expect(back.class).toBe("_test/c");
    });

    it("缺省 ref.window_view = undefined（不破坏旧 ref 字面）", () => {
      const ref: OocObjectRef = { id: "y", class: "_test/c", createdAt: 0 };
      expect(ref.window_view).toBeUndefined();
    });
  });

  describe("thread.construct 显式写 window_view='self'", () => {
    it("self-view ref 持 window_view='self'", async () => {
      const t = await makeThread(SESSION);
      const selfRef = t.contextWindows.find((w) => w.id === threadWindowIdOf(t.id));
      expect(selfRef!.window_view).toBe("self");
    });

    it("callee 门面 + 工具窗 缺省 window_view", async () => {
      const t = await makeThread(SESSION);
      const calleeRef = t.contextWindows.find(
        (w) => w.id === "_builtin/supervisor",
      );
      expect(calleeRef!.window_view).toBeUndefined();
      const fsRef = t.contextWindows.find((w) => w.id === "_builtin/filesystem");
      expect(fsRef!.window_view).toBeUndefined();
    });
  });

  describe("resolveWindowView / resolveDefaultWindowView 命名生效", () => {
    it("resolveDefaultWindowView 命中单视角 builtin", () => {
      const decl = builtinClassRegistry.resolveDefaultWindowView("_builtin/filesystem");
      expect(decl).toBeDefined();
      expect(decl?.view).toBe("default");
    });

    it("resolveWindowView 命中多视角 thread 的 self decl", () => {
      const decl = builtinClassRegistry.resolveWindowView(THREAD_CLASS_ID, "self");
      expect(decl).toBeDefined();
      expect(decl?.view).toBe("self");
      expect(decl?.object_methods).toContain("reply");
    });

    it("DEFAULT_WINDOW_VIEW 常量值 = 'default'", () => {
      expect(DEFAULT_WINDOW_VIEW).toBe("default");
    });
  });

  describe("computeProjectionClass fallback warning", () => {
    it("ref.window_view 缺省 → fallback 推导 + dev-mode warning", () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const origWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);
      try {
        const td: ThreadContext = {
          id: "tx",
          calleeObjectId: "c",
          sessionId: "biz",
          status: "running",
          messages: [],
          events: [],
          contextWindows: [],
        };
        // 不写 window_view → 走 fallback 推导
        const ref: OocObjectRef = {
          id: threadWindowIdOf("tx"),
          class: THREAD_CLASS_ID,
          createdAt: 0,
        };
        const v = computeProjectionClass(td, ref);
        expect(v).toBe("self");
        expect(warnings.some((w) => w.includes("缺 window_view"))).toBe(true);
      } finally {
        console.warn = origWarn;
        if (prevEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevEnv;
      }
    });

    it("ref.window_view 显式存在 → 直接返回 + 不打 warning", () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const origWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);
      try {
        const td: ThreadContext = {
          id: "ty",
          calleeObjectId: "c",
          sessionId: "biz",
          status: "running",
          messages: [],
          events: [],
          contextWindows: [],
        };
        const ref: OocObjectRef = {
          id: "anywhere",
          class: THREAD_CLASS_ID,
          window_view: "custom",
          createdAt: 0,
        };
        const v = computeProjectionClass(td, ref);
        expect(v).toBe("custom");
        expect(warnings.length).toBe(0);
      } finally {
        console.warn = origWarn;
        if (prevEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevEnv;
      }
    });
  });

  describe("RuntimeHandle.instantiate args windowView 透传", () => {
    it("instantiate 传 windowView → 新 ref.window_view 命中", async () => {
      const { ThreadRuntime } = await import(
        "@ooc/builtins/agent/children/thread/runtime/thread-runtime"
      );
      const t = await makeThread(SESSION);
      const runtime = ThreadRuntime.fromThread(t);
      const ref = await runtime.instantiate({
        class: "_builtin/agent/todo",
        windowView: "custom",
      });
      expect(ref.window_view).toBe("custom");
    });

    it("instantiate 不传 windowView → ref.window_view 缺省", async () => {
      const { ThreadRuntime } = await import(
        "@ooc/builtins/agent/children/thread/runtime/thread-runtime"
      );
      const t = await makeThread(SESSION);
      const runtime = ThreadRuntime.fromThread(t);
      const ref = await runtime.instantiate({
        class: "_builtin/agent/todo",
      });
      expect(ref.window_view).toBeUndefined();
    });
  });

  describe("refIdentity helper 剥离 window_view", () => {
    it("同 (id,class) + 不同 window_view → refIdentity 相等", () => {
      const a: OocObjectRef = {
        id: "x",
        class: "c",
        window_view: "self",
        createdAt: 0,
      };
      const b: OocObjectRef = {
        id: "x",
        class: "c",
        window_view: "default",
        createdAt: 999,
      };
      expect(refIdentity(a)).toEqual(refIdentity(b));
      expect(refIdentity(a).id).toBe("x");
      expect(refIdentity(a).class).toBe("c");
    });
  });
});
