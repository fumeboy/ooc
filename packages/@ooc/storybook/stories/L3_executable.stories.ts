/**
 * L3 — Executable（方法 / registry 维度劈分 / tool 原语）。
 * Object = 数据字段 + 程序方法；executable 与 readable 两维度分注册。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { postJson, writeStoneFile } from "../_harness/control-plane";
import { story, check, type Story } from "../_harness/story";

export const L3_STORIES: Story[] = [
  story({
    id: "L3-REG-EXECUTABLE",
    layer: "executable",
    expectation: "registerExecutable 只注册 object methods + 类元，拒绝 readable 字段",
    design: "executable：维度劈分入口。runtime/object-registry.ts:registerExecutable",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      const m = { paths: ["x"], intent: () => [], exec: () => undefined } as any;
      reg.registerExecutable("file", { methods: { x: m } });
      check(!!reg.getObjectDefinition("file").methods.x, "registerExecutable 未注册 method");
    },
  }),

  story({
    id: "L3-REG-READABLE",
    layer: "executable",
    expectation: "registerReadable 注册 windowMethods/readable，与 executable 互不覆盖",
    design: "readable：维度劈分入口；两维度分注册不互相 clobber。object-registry.ts:registerReadable",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      const wm = { paths: ["set_viewport"], intent: () => [], exec: (c: any) => ({ ok: true, state: c.windowState }) } as any;
      const om = { paths: ["reload"], intent: () => [], exec: () => undefined } as any;
      reg.registerReadable("file", { windowMethods: { set_viewport: wm } });
      reg.registerExecutable("file", { methods: { reload: om } });
      const def = reg.getObjectDefinition("file");
      check(!!def.windowMethods?.set_viewport, "readable 维度被覆盖");
      check(!!def.methods.reload, "executable 维度被覆盖");
    },
  }),

  story({
    id: "L3-METHOD-COLLISION",
    layer: "executable",
    expectation: "同一 type 上 object method 与 window method 同名 → 注册期 fail-loud",
    design: "executable/readable：exec 名全局唯一，dispatch 无歧义。assertNoMethodNameCollision",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      const om = { paths: ["set_viewport"], intent: () => [], exec: () => undefined } as any;
      const wm = { paths: ["set_viewport"], intent: () => [], exec: (c: any) => ({ ok: true, state: c.windowState }) } as any;
      reg.registerExecutable("file", { methods: { set_viewport: om } });
      let threw = false;
      try { reg.registerReadable("file", { windowMethods: { set_viewport: wm } }); } catch { threw = true; }
      check(threw, "method↔windowMethod 同名未 fail-loud");
    },
  }),

  story({
    id: "L3-FILE-WINDOWMETHOD",
    layer: "executable",
    expectation: "builtin file 的 set_viewport 是 windowMethod，不在 object methods 表",
    design: "readable：展示控制方法归 windowMethods（readable 维度），与业务 method 分离。builtins/file/readable.ts",
    run: async () => {
      await import("@ooc/builtins/file");
      const { builtinRegistry } = await import("@ooc/core/runtime/object-registry");
      const def = builtinRegistry.getObjectDefinition("file");
      check(!!def.windowMethods?.set_viewport, "file.set_viewport 不是 windowMethod");
      check(!def.methods?.set_viewport, "file.set_viewport 误进 object methods");
    },
  }),

  story({
    id: "L3-CONSTRUCTOR-LOOKUP",
    layer: "executable",
    expectation: "kind=constructor 的 method 经 lookupConstructor 命中",
    design: "executable：root 命令委托到 Object constructor。object-registry.ts:lookupConstructor",
    run: async () => {
      await import("@ooc/builtins/file");
      const { builtinRegistry } = await import("@ooc/core/runtime/object-registry");
      check(!!builtinRegistry.lookupConstructor("file" as any), "file constructor 未命中");
    },
  }),

  story({
    id: "L3-PARENTCLASS-CHAIN",
    layer: "executable",
    expectation: "未注册 type 经 parentClass 链回退解析 method",
    design: "class/executable：method 沿 parentClass 链回退（缺省继承 root）。resolveMethod",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      const m = { paths: ["greet"], intent: () => [], exec: () => undefined } as any;
      reg.registerNewObjectType("base_x" as any, { methods: { greet: m } });
      reg.registerNewObjectType("child_x" as any, { methods: {}, parentClass: "base_x" });
      check(!!reg.resolveMethod("child_x", "greet"), "未沿 parentClass 链解析 method");
    },
  }),

  story({
    id: "L3-UI-METHOD-CALL",
    layer: "executable",
    expectation: "Object 的 for_ui_access 方法经 HTTP /call_method 执行并 data 通道返回结果",
    design: "executable：for_ui_access 方法是 Object 暴露给 UI 的方法（经 HTTP）。modules/stones/api.call-method.ts",
    run: async ({ app, baseDir }) => {
      const id = "calc_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const window = { methods: { add: { description: "add", for_ui_access: true, exec: ({ args }) => ({ ok: true, data: { sum: args.x + args.y } }) } } };`);
      await sleep(350);
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "add", args: { x: 2, y: 3 } });
      check(JSON.stringify(r.json?.data) === JSON.stringify({ sum: 5 }), `data=${JSON.stringify(r.json?.data)}`);
    },
  }),

  story({
    id: "L3-WINDOW-COMMAND-LOAD",
    layer: "executable",
    expectation: "Object 的 window.methods（LLM 路径命令）经 loadObjectWindow 可加载",
    design: "executable：window.methods 是 Object 暴露给 LLM 的命令面。runtime/server-loader",
    run: async ({ app, baseDir }) => {
      const id = "cmd_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const window = { methods: { run: { description: "run", intents: ["run"], exec: async () => ({ ok: true }) } } };`);
      const { loadObjectWindow } = await import("@ooc/core/runtime/server-loader");
      const win = await loadObjectWindow({ baseDir, objectId: id });
      check(!!win?.methods?.run, `window.methods.run 未加载：${JSON.stringify(Object.keys(win?.methods ?? {}))}`);
    },
  }),
];
