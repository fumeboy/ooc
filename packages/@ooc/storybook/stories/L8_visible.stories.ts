/**
 * L8 — Visible（client / ooc:// / SPA route）。
 * Object 为自己写 client 界面；ooc:// 原生寻址由 visible 渲染层 1:1 映射 SPA route。
 * 真正的 Vite serve / 浏览器渲染需 live Vite → skip 归 Tier B/F；此处断控制面映射端点。
 */
import { postJson, getJson, writeStoneFile } from "../_harness/control-plane";
import { story, check, skip, type Story } from "../_harness/story";

export const L8_STORIES: Story[] = [
  story({
    id: "L8-CLIENT-URL-STONE",
    layer: "visible",
    expectation: "stone scope client-source-url 指向 visible/index.tsx（单页）",
    design: "visible：ooc://client/... 原生寻址映射到 visible 源文件。modules/ui/api.client-source-url.ts",
    run: async ({ app, baseDir }) => {
      const id = "vis_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "visible/index.tsx", "export default function V() { return null; }\n");
      const r = await getJson(app, `/api/objects/stone/${id}/client-source-url`);
      check(r.status === 200, `status=${r.status} body=${JSON.stringify(r.json)?.slice(0, 80)}`);
      const url = String(r.json?.fsUrl ?? r.json?.absPath ?? "");
      check(/visible\/index\.tsx/.test(url), `未指向 visible/index.tsx：${url}`);
    },
  }),

  story({
    id: "L8-TYPES-CATALOG",
    layer: "visible",
    expectation: "/api/objects/_shared/types 列出全部已注册 type",
    design: "visible/executable：对象类型目录（前端按 type 索引 method）。api.list-window-types 别名",
    run: async ({ app }) => {
      const r = await getJson(app, "/api/objects/_shared/types");
      check(r.status === 200, `status=${r.status}`);
      const types = (r.json?.items ?? []).map((e: any) => e.type);
      check(types.length >= 5 && types.includes("file"), `types 异常：${JSON.stringify(types)}`);
    },
  }),

  story({
    id: "L8-WORLD-CONFIG",
    layer: "visible",
    expectation: "/api/world/config 返回 siteName 等 world 级配置",
    design: "visible/app-server：world 级公开配置（前端 Logo 等）。modules/world-config/index.ts",
    run: async ({ app }) => {
      const r = await getJson(app, "/api/world/config");
      check(r.status === 200, `status=${r.status}`);
      check(typeof r.json?.siteName !== "undefined", `缺 siteName：${JSON.stringify(r.json)}`);
    },
  }),

  story({
    id: "L8-CLIENT-URL-FLOW",
    layer: "visible",
    expectation: "flow scope client-source-url 指向 client/pages/:page.tsx（多页）",
    design: "visible：flow 作用域是多页应用。api.client-source-url 形态2。需多页 client 资产",
    run: async () => skip("flow scope 多页 client 资产 + live Vite 渲染需 F 层（Tier B/frontend e2e）"),
  }),
];
