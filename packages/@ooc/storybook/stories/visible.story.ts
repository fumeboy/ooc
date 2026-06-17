/**
 * Story: visible —— Object 自定义 UI 组件（visible/index.tsx）。
 *
 * 能力：client-source-url 暴露组件入口；Vite serve /@fs（有 Vite 时实测，否则 SKIP）；
 * 安全边界拒绝 executable 路径；visible 变更触发后端 stone:changed kind=view 事件；
 * UI↔行为闭环（callMethod 端点调通 executable）。规格见 visible 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { stoneDir as realStoneDir } from "@ooc/core/persistable";
import { mkServer, postJson, getJson, writeStoneFile, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

const VITE = "http://localhost:5173";

async function viteWorldRoot(): Promise<string | null> {
  try {
    if (!(await fetch(`${VITE}/api/health`, { redirect: "manual" })).ok) return null;
    const stones = (await (await fetch(`${VITE}/api/stones`)).json()) as { items?: { dir: string }[] };
    const d = stones?.items?.[0]?.dir;
    if (!d) return null;
    const idx = d.indexOf("/stones/");
    return idx >= 0 ? d.slice(0, idx) : null;
  } catch { return null; }
}

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  const dirOf = (id: string) => realStoneDir({ baseDir, objectId: id });
  try {
    // TC-VIS-01: client-source-url 返回正确 absPath/fsUrl，指向真实文件
    {
      const id = "ui_demo";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "visible/index.tsx", `export default () => null;`);
      const r = await getJson(app, `/api/objects/stone/${id}/client-source-url`);
      const absPath = r.json?.absPath ?? "";
      const ok = r.status === 200 && absPath.endsWith(join("visible", "index.tsx"))
        && r.json?.fsUrl === `/@fs${absPath}` && existsSync(absPath);
      rec.ok("TC-VIS-01", "client-source-url 返回正确 absPath/fsUrl，指向真实文件", ok,
        `status=${r.status}, absPath=${absPath}, fsUrl=${r.json?.fsUrl}`);
    }

    // TC-VIS-02/03: Vite serve + 安全边界 —— 仅当 live Vite worldRoot === 本 world 时实测，否则 SKIP
    {
      const root = await viteWorldRoot();
      if (root === baseDir) {
        const vp = join(dirOf("ui_demo"), "visible", "index.tsx");
        const resp = await fetch(`${VITE}/@fs${vp}`);
        const body = await resp.text();
        rec.ok("TC-VIS-02", "Vite serve /@fs visible 组件返回模块代码",
          resp.status === 200 && body.includes("export default"), `status=${resp.status}`);
        const ep = join(dirOf("ui_demo"), "executable", "index.ts");
        writeStoneFile(baseDir, "ui_demo", "executable/index.ts", `export default { methods: [] };`);
        const er = await fetch(`${VITE}/@fs${ep}`);
        const eb = await er.text();
        rec.ok("TC-VIS-03", "Vite 安全边界：拒绝 serve executable 路径（403）",
          er.status === 403 && (eb.includes("Forbidden") || eb.includes("Restricted")), `status=${er.status}`);
      } else {
        rec.skip("TC-VIS-02", "Vite serve visible 组件", `无匹配 world 的 live Vite（root=${root}）`);
        rec.skip("TC-VIS-03", "Vite 安全边界拒绝 executable", "同上");
      }
    }

    // TC-VIS-04: visible 变更触发 stone:changed kind=view 事件（Vite HMR 的后端侧信号）
    {
      const id = "hmr_demo";
      await postJson(app, "/api/stones", { objectId: id });
      const runtime = (app.store as any).runtime;
      if (!runtime?.stoneRegistry?.on) {
        rec.skip("TC-VIS-04", "visible 变更触发 stone:changed kind=view", "runtime.stoneRegistry 不可达（非 dev）");
      } else {
        await sleep(500);
        let caught: any = null;
        const off = runtime.stoneRegistry.on("stone:changed", (ev: any) => { if (ev.objectId === id) caught = ev; });
        writeStoneFile(baseDir, id, "visible/index.tsx", `export default () => 'v1';`);
        await sleep(400);
        const v1 = caught; caught = null;
        writeStoneFile(baseDir, id, "visible/index.tsx", `export default () => 'v2';`);
        await sleep(400);
        const v2 = caught;
        off();
        rec.ok("TC-VIS-04", "visible/index.tsx 变更触发 stone:changed kind=view 事件",
          v1?.kind === "view" && v1?.objectId === id && v2?.kind === "view" && Array.isArray(v1?.files) && v1.files.length > 0,
          `v1=${JSON.stringify(v1)}, v2=${JSON.stringify(v2)}`);
      }
    }

    // TC-VIS-05: UI↔行为闭环 —— visible 组件存在 + callMethod 端点调通 executable。
    // 新模型：visible/index.tsx 是前端组件（callMethod 经 HTTP 调后端）；executable 程序路由由
    // stone 根 index.ts 的 `export const Class`（OocClass）装配，object method 三参 `(ctx, self, args)`、
    // 返回 ObjectMethodResult `{ data }`。call_method 经 server-loader 从根 index.ts 取 for_ui_access 方法。
    {
      const id = "ui_loop";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "visible/index.tsx",
        `export default function Demo({ callMethod }: any) { const onClick = () => callMethod?.("greet", { name: "ooc" }); return null; }`);
      writeStoneFile(baseDir, id, "index.ts",
        `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";\nexport const Class: OocClass = { executable: { methods: [{ name: "greet", description: "greet", for_ui_access: true, exec: (ctx, self, args) => ({ data: { hello: args.name } }) }] } };`);
      await sleep(300);
      const urlResp = await getJson(app, `/api/objects/stone/${id}/client-source-url`);
      const callResp = await postJson(app, `/api/stones/${id}/call_method`, { method: "greet", args: { name: "ooc" } });
      rec.ok("TC-VIS-05", "UI↔行为闭环：visible 组件存在 + callMethod 端点调通 executable",
        urlResp.status === 200 && callResp.json?.data?.hello === "ooc",
        `urlOk=${urlResp.status}, call=${JSON.stringify(callResp.json?.data)}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "visible", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor, getStoneSelfWithRetry, calledMethodOk, req } from "../_harness/agent-native";

/**
 * Tier B —— agent-native：supervisor 为一个新对象搭好可见性的前提（创建对象）。
 *
 * 注：supervisor 的 self.md 明确「✗ 不直接编辑 UI（派 visible 维度的 Agent）」——它正确地不亲手写
 * visible/index.tsx。故本演示验证 supervisor 能做的部分（创建可被赋予 UI 的对象）；visible 页面**产出**
 * 由 visible 维度 agent 负责，确定性验证见 Tier A TC-VIS-01/05 + frontend e2e。若 supervisor 恰好也写了
 * visible（url 可解析）则更佳。
 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  const obj = `sb_ui_${tag}`;
  return demoViaSupervisor("visible", `sb-an-vis-${tag}`,
    `请创建一个名为 ${obj} 的对象（它将拥有自己的 UI 页面）。如果你能顺手写个最简单的 visible/index.tsx 就更好。`,
    async ({ sid, threadId }) => {
      // 新模型：create_object 落 session worktree，evolve 合入 main 有延迟。建对象能力 = create_object 成功。
      const self = await getStoneSelfWithRetry(obj);
      const createdInMain = self.status === 200;
      const created = createdInMain || (await calledMethodOk(sid, "supervisor", threadId, "create_object"));
      const url = await req("GET", `/api/objects/stone/${obj}/client-source-url`);
      const hasUi = url.status === 200;
      return {
        ok: created,
        detail: created
          ? `${obj} 已建（${createdInMain ? "evolve 合入 main" : "create_object 落 session worktree"}，可见性前提就绪）；visible 页面${hasUi ? "已由 supervisor 顺手产出" : "待 visible 维度 agent 产出——supervisor 边界不直接编辑 UI，Tier A TC-VIS 已覆盖产物验证"}`
          : `created 失败——agent 未成功建对象`,
      };
    });
}
