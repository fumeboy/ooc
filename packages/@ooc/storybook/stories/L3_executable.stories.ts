/**
 * L3 — Executable（object method / registry 维度劈分 / tool 原语）。
 *
 * Wave4 对象模型：class 经一处 `register(classId, OocClass, {parentClass?})` 注册——OocClass 把
 * executable（object method）/ readable（window method）/ construct / persistable 装配进一个对象；
 * registry 单跳继承解析（resolveObjectMethod(s) / resolveWindowMethod / resolveConstructor /
 * resolveParentClassChain）。退役旧双入口 registerExecutable/registerReadable + registerWindowClass +
 * getObjectDefinition + resolveMethod + lookupConstructor + 多级 parentClass 链 + root 回退。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { postJson, writeStoneFile } from "../_harness/control-plane";
import { story, check, type Story } from "../_harness/story";

/** builtin file class 的归一 id（register-builtins 注册键 `_builtin/filesystem/file` → strip `_builtin/`）。 */
const FILE_CLASS = "filesystem/file";

export const L3_STORIES: Story[] = [
  story({
    id: "L3-REG-EXECUTABLE",
    layer: "executable",
    expectation: "register 一个 OocClass 的 executable.methods，经 resolveObjectMethod 命中",
    design: "executable：维度装配入口 register(classId, OocClass)。runtime/object-registry.ts:register",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      reg.register("t_reg_exec", {
        executable: { methods: [{ name: "x", description: "x", exec: () => undefined }] },
      });
      check(!!reg.getClass("t_reg_exec")?.executable?.methods.find((m) => m.name === "x"),
        "register 未装配 executable method");
      check(!!reg.resolveObjectMethod("t_reg_exec", "x"), "resolveObjectMethod 未命中 method");
    },
  }),

  story({
    id: "L3-REG-READABLE",
    layer: "executable",
    expectation: "同一 OocClass 的 readable.window_methods 与 executable.methods 各自解析、互不覆盖",
    design: "readable/executable：两维度同 class 装配；resolveWindowMethod / resolveObjectMethod 分别命中。object-registry.ts",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      reg.register("t_reg_readable", {
        executable: { methods: [{ name: "reload", description: "reload", exec: () => undefined }] },
        readable: {
          readable: () => ({ class: "t_reg_readable", content: [] }),
          window: [{
            class: "t_reg_readable",
            object_methods: ["reload"],
            window_methods: [{ name: "set_viewport", description: "v", exec: (_c, _s, before) => before }],
          }],
        },
      });
      check(!!reg.resolveWindowMethod("t_reg_readable", "set_viewport"), "readable 维度 window method 未解析");
      check(!!reg.resolveObjectMethod("t_reg_readable", "reload"), "executable 维度 object method 未解析");
    },
  }),

  story({
    id: "L3-METHOD-COLLISION",
    layer: "executable",
    expectation: "同一 class 上 object method 与 window method 同名 → register 期 fail-loud",
    design: "executable/readable：exec 名 dispatch 唯一，重名歧义。object-registry.ts:assertNoMethodNameCollision",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      let threw = false;
      try {
        reg.register("t_collision", {
          executable: { methods: [{ name: "set_viewport", description: "x", exec: () => undefined }] },
          readable: {
            readable: () => ({ class: "t_collision", content: [] }),
            window: [{
              class: "t_collision",
              object_methods: [],
              window_methods: [{ name: "set_viewport", description: "v", exec: (_c, _s, before) => before }],
            }],
          },
        });
      } catch { threw = true; }
      check(threw, "method↔windowMethod 同名未 fail-loud");
    },
  }),

  story({
    id: "L3-FILE-WINDOWMETHOD",
    layer: "executable",
    expectation: "builtin file 的 set_viewport 是 window method，不在 object methods 表",
    design: "readable：展示控制方法归 window_methods，与业务 object method 分离。builtins/filesystem/children/file/readable",
    run: async () => {
      await import("@ooc/core/runtime/register-builtins");
      const { builtinRegistry } = await import("@ooc/core/runtime/object-registry");
      check(!!builtinRegistry.resolveWindowMethod(FILE_CLASS, "set_viewport"), "file.set_viewport 不是 window method");
      check(!builtinRegistry.resolveObjectMethod(FILE_CLASS, "set_viewport"), "file.set_viewport 误进 object methods");
    },
  }),

  story({
    id: "L3-CONSTRUCTOR-LOOKUP",
    layer: "executable",
    expectation: "非单例 class file 的 construct 经 resolveConstructor 命中",
    design: "executable：非单例 class 的实例化委托到 construct。object-registry.ts:resolveConstructor",
    run: async () => {
      await import("@ooc/core/runtime/register-builtins");
      const { builtinRegistry } = await import("@ooc/core/runtime/object-registry");
      check(!!builtinRegistry.resolveConstructor(FILE_CLASS), "file construct 未命中");
    },
  }),

  story({
    id: "L3-PARENTCLASS-CHAIN",
    layer: "executable",
    expectation: "object 经 ooc.class 单跳继承父类，子类未声明的 method 沿父类解析",
    design: "class/executable：object→class 单跳继承（class 不继承 class、无 root 回退）。object-registry.ts:resolveParentClassChain",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      reg.register("base_x", {
        executable: { methods: [{ name: "greet", description: "g", exec: () => undefined }] },
      });
      reg.register("child_x", { executable: { methods: [] } }, { parentClass: "base_x" });
      check(JSON.stringify(reg.resolveParentClassChain("child_x")) === JSON.stringify(["base_x"]),
        "单跳父类链解析不对");
      check(!!reg.resolveObjectMethod("child_x", "greet"), "未沿单跳父类解析 method");
    },
  }),

  story({
    id: "L3-UI-METHOD-CALL",
    layer: "executable",
    expectation: "Object 的 visible/server 方法经 HTTP /call_method 执行并 data 通道返回结果",
    design: "visible/server：visible/server 方法是 Object 暴露给人类侧 UI 的方法（经 HTTP）。modules/stones/api.call-method.ts + registry.resolveVisibleServer",
    run: async ({ app, baseDir }) => {
      const id = "calc_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "index.ts",
        `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
         export const Class: OocClass = { visibleServer: { methods: [
           { name: "add", description: "add",
             exec: (_ctx, _self, args) => ({ data: { sum: args.x + args.y } }) },
         ] } };`);
      await sleep(350);
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "add", args: { x: 2, y: 3 } });
      check(JSON.stringify(r.json?.data) === JSON.stringify({ sum: 5 }), `data=${JSON.stringify(r.json?.data)}`);
    },
  }),

  story({
    id: "L3-WINDOW-COMMAND-LOAD",
    layer: "executable",
    expectation: "Object 的 executable.methods（LLM 命令面）经 loadStoneClass 可加载",
    design: "executable：executable.methods 是 Object 暴露给 LLM 的命令面。runtime/server-loader:loadStoneClass",
    run: async ({ app, baseDir }) => {
      const id = "cmd_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "index.ts",
        `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
         export const Class: OocClass = { executable: { methods: [
           { name: "run", description: "run", exec: async () => ({ message: "ok" }) },
         ] } };`);
      const { loadStoneClass } = await import("@ooc/core/runtime/server-loader");
      const loaded = await loadStoneClass({ baseDir, objectId: id });
      const names = (loaded?.cls?.executable?.methods ?? []).map((m) => m.name);
      check(names.includes("run"), `executable.methods.run 未加载：${JSON.stringify(names)}`);
    },
  }),
];
