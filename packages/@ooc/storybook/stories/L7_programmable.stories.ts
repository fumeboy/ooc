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
    expectation: "改写 stone index.ts 后 loadStoneClass 加载到新 object method",
    design: "programmable（Wave4）：Object 自写 `export const Class`（executable.methods），运行时热更（按 index.ts mtime）。runtime/server-loader",
    run: async ({ app, baseDir }) => {
      const id = "prog_obj";
      await postJson(app, "/api/stones", { objectId: id });
      const { loadStoneClass } = await import("@ooc/core/runtime/server-loader");
      const names = (loaded: any): string[] => (loaded?.cls?.executable?.methods ?? []).map((m: any) => m.name);
      writeStoneFile(baseDir, id, "index.ts",
        `export const Class = { executable: { methods: [{ name: "alpha", description: "alpha", exec: async () => ({}) }] } };`);
      await sleep(350);
      const w1 = await loadStoneClass({ baseDir, objectId: id });
      check(names(w1).includes("alpha"), "首版 method alpha 未加载");
      writeStoneFile(baseDir, id, "index.ts",
        `export const Class = { executable: { methods: [{ name: "beta", description: "beta", exec: async () => ({}) }] } };`);
      await sleep(350);
      const w2 = await loadStoneClass({ baseDir, objectId: id });
      check(names(w2).includes("beta") && !names(w2).includes("alpha"), `热更未反映新 method：${JSON.stringify(names(w2))}`);
    },
  }),

  story({
    id: "L7-UI-METHOD-HOTRELOAD",
    layer: "programmable",
    expectation: "改 for_ui_access 方法后 /call_method 反映新逻辑",
    design: "programmable（Wave4）：for_ui_access object method 热更后 HTTP 调用走新实现。server-loader 热更（index.ts mtime）+ api.call-method",
    run: async ({ app, baseDir }) => {
      const id = "prog_ui";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "index.ts",
        `export const Class = { executable: { methods: [{ name: "f", description: "f", for_ui_access: true, exec: () => ({ data: { v: 1 } }) }] } };`);
      await sleep(350);
      let r = await postJson(app, `/api/stones/${id}/call_method`, { method: "f", args: {} });
      check(JSON.stringify(r.json?.data) === JSON.stringify({ v: 1 }), `v1 data=${JSON.stringify(r.json?.data)}`);
      writeStoneFile(baseDir, id, "index.ts",
        `export const Class = { executable: { methods: [{ name: "f", description: "f", for_ui_access: true, exec: () => ({ data: { v: 2 } }) }] } };`);
      await sleep(350);
      r = await postJson(app, `/api/stones/${id}/call_method`, { method: "f", args: {} });
      check(JSON.stringify(r.json?.data) === JSON.stringify({ v: 2 }), `热更后 data=${JSON.stringify(r.json?.data)}`);
    },
  }),

  story({
    id: "L7-SERVER-SOURCE-RW",
    layer: "programmable",
    expectation: "PUT /file(executable/index.ts) 再 GET /server-source 读写一致",
    design: "programmable：Object 方法源经控制面可读可写。modules/stones/api.put-file + api.get-server-source",
    run: async ({ app }) => {
      const id = "prog_src";
      await postJson(app, "/api/stones", { objectId: id });
      const code = "export const window = { methods: { ping: { description: 'ping', for_ui_access: true, exec: () => ({ ok: true, data: 'pong' }) } } };\n";
      const put = await putJson(app, `/api/stones/${id}/file`, { path: "executable/index.ts", content: code }, { "X-Overwrite-Confirm": "true" });
      check(put.status === 200, `PUT status=${put.status}`);
      const get = await getJson(app, `/api/stones/${id}/server-source`);
      check(get.json?.code === code, `读写不一致：${JSON.stringify(get.json?.code)?.slice(0, 60)}`);
    },
  }),
];
