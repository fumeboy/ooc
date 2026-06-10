import { test, expect } from "bun:test";
import "@ooc/builtins/example"; // side-effect: registerExecutable + registerReadable
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import type { ExampleWindow } from "@ooc/builtins/example/types.js";

test("example executable 维度：object method + constructor 经 registerExecutable 注册", () => {
  const def = builtinRegistry.getObjectDefinition("example");
  expect(def.methods?.bump).toBeDefined();
  expect(def.methods?.close).toBeDefined();
  expect(def.methods?.example).toBeDefined();
  expect(def.methods?.example?.kind).toBe("constructor");
});

test("example readable 维度：readable / windowMethods / compressView 经 registerReadable 注册", () => {
  const def = builtinRegistry.getObjectDefinition("example");
  expect(def.readable).toBeDefined();
  expect(def.windowMethods?.set_viewport).toBeDefined();
  expect(def.compressView).toBeDefined();
  // 维度隔离：set_viewport 是 window method，不混进 object methods。
  expect(def.methods?.set_viewport).toBeUndefined();
});

test("example constructor 构造窗口，bump 累加业务数据", async () => {
  const def = builtinRegistry.getObjectDefinition("example");
  const out = (await def.methods!.example!.exec({ args: { message: "hi\nthere" } } as any)) as {
    ok: true;
    window: ExampleWindow;
  };
  expect(out.ok).toBe(true);
  expect(out.window.class).toBe("example");
  expect(out.window.message).toBe("hi\nthere");
  expect(out.window.bumpCount).toBe(0);

  const self = out.window;
  await def.methods!.bump!.exec({ args: {}, self } as any);
  expect(self.bumpCount).toBe(1);
});

test("example readable 渲染 bump_count + viewport 切片后的 message", async () => {
  const { readable } = await import("@ooc/builtins/example/readable.js");
  const nodes = readable({
    window: {
      class: "example",
      message: "line0\nline1\nline2",
      bumpCount: 3,
      state: { viewport: { lineStart: 0, lineEnd: 1, columnStart: 0, columnEnd: 80 } },
    },
    thread: {},
  } as any);
  const bump = nodes.find((n: any) => n.tag === "bump_count") as any;
  expect(bump?.children?.[0]?.value).toBe("3");
  const message = nodes.find((n: any) => n.tag === "message") as any;
  // viewport line_end=1 → 只切出第一行 "line0"，其余行被折叠（overflow marker）。
  const text = message?.children?.[0]?.value as string;
  expect(text.startsWith("line0")).toBe(true);
  expect(text).not.toContain("line1");
});
