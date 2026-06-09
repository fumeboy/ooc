/**
 * L7 — Programmable（server 方法 / 热更）。
 * Object 为自己写 executable/server 方法，运行时热更。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { postJson, putJson, getJson, writeStoneFile } from "../_harness/control-plane";
import { story, check, type Story } from "../_harness/story";

export const L7_STORIES: Story[] = [
  story({
    id: "L7-EXEC-HOTRELOAD",
    layer: "programmable",
    expectation: "改写 executable/index.ts 后 loadObjectWindow 加载到新 method",
    design: "programmable：Object 自写方法库，运行时热更（fs.watch）。runtime/server-loader",
    run: async ({ app, baseDir }) => {
      const id = "prog_obj";
      await postJson(app, "/api/stones", { objectId: id });
      const { loadObjectWindow } = await import("@ooc/core/runtime/server-loader");
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const window = { methods: { alpha: { paths: ["alpha"], intent: () => [], exec: async () => ({ ok: true }) } } };\nexport const ui_methods = {};`);
      await sleep(350);
      const w1 = await loadObjectWindow({ baseDir, objectId: id });
      check(!!w1?.methods?.alpha, "首版 method alpha 未加载");
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const window = { methods: { beta: { paths: ["beta"], intent: () => [], exec: async () => ({ ok: true }) } } };\nexport const ui_methods = {};`);
      await sleep(350);
      const w2 = await loadObjectWindow({ baseDir, objectId: id });
      check(!!w2?.methods?.beta && !w2?.methods?.alpha, `热更未反映新 method：${JSON.stringify(Object.keys(w2?.methods ?? {}))}`);
    },
  }),

  story({
    id: "L7-UI-METHOD-HOTRELOAD",
    layer: "programmable",
    expectation: "改 ui_methods 后 /call_method 反映新逻辑",
    design: "programmable：ui_methods 热更后 HTTP 调用走新实现。server-loader 热更 + api.call-method",
    run: async ({ app, baseDir }) => {
      const id = "prog_ui";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const ui_methods = { f: { fn: () => ({ v: 1 }) } };\nexport const window = { methods: {} };`);
      await sleep(350);
      let r = await postJson(app, `/api/stones/${id}/call_method`, { method: "f", args: {} });
      check(JSON.stringify(r.json?.returnValue) === JSON.stringify({ v: 1 }), `v1 returnValue=${JSON.stringify(r.json?.returnValue)}`);
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const ui_methods = { f: { fn: () => ({ v: 2 }) } };\nexport const window = { methods: {} };`);
      await sleep(350);
      r = await postJson(app, `/api/stones/${id}/call_method`, { method: "f", args: {} });
      check(JSON.stringify(r.json?.returnValue) === JSON.stringify({ v: 2 }), `热更后 returnValue=${JSON.stringify(r.json?.returnValue)}`);
    },
  }),

  story({
    id: "L7-SERVER-SOURCE-RW",
    layer: "programmable",
    expectation: "PUT 再 GET /api/stones/:id/server-source 读写一致",
    design: "programmable：Object 方法源经控制面可读可写。modules/stones/api.put/get-server-source",
    run: async ({ app }) => {
      const id = "prog_src";
      await postJson(app, "/api/stones", { objectId: id });
      const code = "export const ui_methods = { ping: { fn: () => 'pong' } };\n";
      const put = await putJson(app, `/api/stones/${id}/server-source`, { code }, { "X-Overwrite-Confirm": "true" });
      check(put.status === 200, `PUT status=${put.status}`);
      const get = await getJson(app, `/api/stones/${id}/server-source`);
      check(get.json?.code === code, `读写不一致：${JSON.stringify(get.json?.code)?.slice(0, 60)}`);
    },
  }),
];
