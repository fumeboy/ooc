/**
 * Story: visible —— Object 自定义 UI 组件（visible/index.tsx）。
 *
 * 能力：client-source-url 暴露组件入口；Vite serve /@fs（有 Vite 时实测，否则 SKIP）；
 * 安全边界拒绝 executable 路径；visible 变更触发后端 stone:changed kind=view 事件；
 * UI↔行为闭环（callMethod 端点调通 executable）。规格见 specs/capability_visible.md。
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
        writeStoneFile(baseDir, "ui_demo", "executable/index.ts", `export const ui_methods = {};`);
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

    // TC-VIS-05: UI↔行为闭环 —— visible 组件存在 + callMethod 端点调通 executable
    {
      const id = "ui_loop";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "visible/index.tsx",
        `export default function Demo({ callMethod }: any) { const onClick = () => callMethod?.("greet", { name: "ooc" }); return null; }`);
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const ui_methods = { greet: { fn: (_ctx, args) => ({ hello: args.name }) } };\nexport const window = { commands: {} };`);
      await sleep(300);
      const urlResp = await getJson(app, `/api/objects/stone/${id}/client-source-url`);
      const callResp = await postJson(app, `/api/stones/${id}/call_method`, { method: "greet", args: { name: "ooc" } });
      rec.ok("TC-VIS-05", "UI↔行为闭环：visible 组件存在 + callMethod 端点调通 executable",
        urlResp.status === 200 && callResp.json?.returnValue?.hello === "ooc",
        `urlOk=${urlResp.status}, call=${JSON.stringify(callResp.json?.returnValue)}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "visible", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}
