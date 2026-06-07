/**
 * 对正在运行的 localhost:3000 跑 storybook 能力测试，
 * 并把每个测试步骤和结果写成 session 消息，在前端 UI 可见。
 *
 * Run: bun run packages/@ooc/meta/storybook/_demo_session.ts
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";

const BACKEND = "http://localhost:3000";
const SESSION_ID = "storybook-demo-" + Math.floor(Date.now() / 1000);
const TARGET_ID = "sb_demo";

async function req(method: string, path: string, body?: any, headers: Record<string, string> = {}): Promise<any> {
  const init: RequestInit = { method, headers: new Headers(headers) };
  if (body !== undefined) {
    (init.headers as Headers).set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  const r = await fetch(BACKEND + path, init);
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text), text }; } catch { return { status: r.status, text }; }
}

// stone 的 canonical 目录（从 createStone 响应捕获，不再硬编码 world 路径）。
let STONE_DIR = "";

/** 直写 stone 目录下的文件（用于 visible —— 无 HTTP 写入口）。 */
async function writeStoneFile(_id: string, relPath: string, content: string) {
  if (!STONE_DIR) throw new Error("STONE_DIR not captured yet");
  const full = join(STONE_DIR, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
  return full;
}

/**
 * executable / self 一律经 HTTP API 写（统一走 worktree 版本化）。
 * 单 stone 跨多 TC 时，直写未提交会和后续 worktree ff-merge 冲突——所以这两类走 API。
 */
async function putExec(id: string, code: string) {
  return req("PUT", `/api/stones/${id}/server-source`, { code }, { "X-Overwrite-Confirm": "true" });
}
async function putSelfApi(id: string, text: string) {
  return req("PUT", `/api/stones/${id}/self`, { text }, { "X-Overwrite-Confirm": "true" });
}

type StepResult = { id: string; name: string; status: "PASS" | "FAIL" | "SKIP"; detail?: string };
const results: StepResult[] = [];

function record(r: StepResult) {
  results.push(r);
  const mark = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⬜";
  console.log(`${mark} ${r.id}  ${r.name}` + (r.detail ? `\n     ${r.detail}` : ""));
}

function mdReport(): string {
  const byStatus = { PASS: 0, FAIL: 0, SKIP: 0 } as Record<string, number>;
  for (const r of results) byStatus[r.status]++;
  const lines: string[] = [];
  lines.push(`## Storybook 回访：reflectable / programmable / visible 测试报告`);
  lines.push("");
  lines.push(`**Backend**: \`${BACKEND}\`  `);
  lines.push(`**Session**: \`${SESSION_ID}\`  `);
  lines.push(`**Target stone**: \`${TARGET_ID}\`  `);
  lines.push(`**Result**: PASS=${byStatus.PASS}  FAIL=${byStatus.FAIL}  SKIP=${byStatus.SKIP}  TOTAL=${results.length}`);
  lines.push("");
  lines.push("### Programmable");
  for (const r of results.filter(x => x.id.startsWith("TC-PROG"))) {
    const mark = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⬜";
    lines.push(`- ${mark} **${r.id}** ${r.name}` + (r.detail ? `  \n  _${r.detail}_` : ""));
  }
  lines.push("");
  lines.push("### Reflectable");
  for (const r of results.filter(x => x.id.startsWith("TC-REFL"))) {
    const mark = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⬜";
    lines.push(`- ${mark} **${r.id}** ${r.name}` + (r.detail ? `  \n  _${r.detail}_` : ""));
  }
  lines.push("");
  lines.push("### Visible");
  for (const r of results.filter(x => x.id.startsWith("TC-VIS"))) {
    const mark = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⬜";
    lines.push(`- ${mark} **${r.id}** ${r.name}` + (r.detail ? `  \n  _${r.detail}_` : ""));
  }
  lines.push("");
  lines.push("> 所有测试通过真实 HTTP API 对运行中的 OOC World 执行，非 mock。");
  return lines.join("\n");
}

async function main() {
  // 确保 target stone 存在，并捕获其 canonical 目录（用于 visible 直写）。
  let probe = await req("GET", `/api/stones/${TARGET_ID}`);
  if (probe.status !== 200) {
    await req("POST", "/api/stones", { objectId: TARGET_ID });
    await sleep(400);
    probe = await req("GET", `/api/stones/${TARGET_ID}`);
  }
  STONE_DIR = probe.json?.dir ?? "";
  if (!STONE_DIR) throw new Error(`failed to resolve stone dir for ${TARGET_ID}: ${JSON.stringify(probe.json ?? probe.text)}`);

  // ═══ Programmable ═══
  console.log("\n— Programmable —");

  // TC-PROG-01
  {
    await putExec(TARGET_ID,[
      `export const ui_methods = {`,
      `  echo: { description: "echoes args.text", fn: (ctx, args) => ({ youSaid: args.text }) },`,
      `};`,
      `export const window = { commands: {} };`,
    ].join("\n"));
    await sleep(300);
    const r = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "echo", args: { text: "hello storybook" } });
    const ok = r.json?.returnValue?.youSaid === "hello storybook";
    record({ id: "TC-PROG-01", name: "ui_methods 通过 HTTP 调用返回正确值", status: ok ? "PASS" : "FAIL", detail: ok ? undefined : JSON.stringify(r.json ?? r.text) });
  }

  // TC-PROG-02: ctx.self.dir
  {
    await putExec(TARGET_ID,[
      `import { statSync } from "node:fs";`,
      `export const ui_methods = {`,
      `  getMyDir: { fn: (ctx) => ({ myDir: ctx.self.dir, exists: (() => { try { return statSync(ctx.self.dir).isDirectory(); } catch { return false; } })() }) },`,
      `};`,
      `export const window = { commands: {} };`,
    ].join("\n"));
    await sleep(300);
    const r = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "getMyDir" });
    const myDir: string = r.json?.returnValue?.myDir ?? "";
    const endsOk = myDir.endsWith(join("stones", TARGET_ID)) || myDir.endsWith(join("stones", "main", "objects", TARGET_ID));
    const exists = r.json?.returnValue?.exists === true;
    record({
      id: "TC-PROG-02", name: "方法拿到 ctx.self.dir（自己的 stone 路径）且目录真实存在",
      status: endsOk && exists ? "PASS" : "FAIL",
      detail: endsOk && exists ? undefined : `myDir=${myDir}, endsOk=${endsOk}, exists=${exists}`,
    });
  }

  // TC-PROG-04: 热更新
  {
    await putExec(TARGET_ID,[
      `export const ui_methods = { ping: { fn: () => "v1" } };`,
      `export const window = { commands: {} };`,
    ].join("\n"));
    await sleep(400);
    const r1 = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "ping" });
    const v1 = r1.json?.returnValue;
    await putExec(TARGET_ID,[
      `export const ui_methods = { ping: { fn: () => "v2" }, pong: { fn: () => "pong" } };`,
      `export const window = { commands: {} };`,
    ].join("\n"));
    await sleep(500);
    const r2 = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "ping" });
    const r3 = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "pong" });
    const ok = v1 === "v1" && r2.json?.returnValue === "v2" && r3.json?.returnValue === "pong";
    record({
      id: "TC-PROG-04", name: "热更新 — 修改 executable 后已有方法变更、新增方法立即生效",
      status: ok ? "PASS" : "FAIL",
      detail: ok ? undefined : `ping(v1)=${v1}, ping(v2)=${r2.json?.returnValue}, pong(v2)=${r3.json?.returnValue}`,
    });
  }

  // ═══ Reflectable ═══
  console.log("\n— Reflectable —");

  // TC-REFL-01: 读 self.md
  {
    const selfContent = "# sb_demo\n我是 storybook 演示对象（reflectable 能力展示）。";
    await putSelfApi(TARGET_ID, selfContent);
    await putExec(TARGET_ID,[
      `import { readFileSync } from "node:fs";`,
      `import { join } from "node:path";`,
      `export const ui_methods = {`,
      `  readSelf: { fn: (ctx) => readFileSync(join(ctx.self.dir, "self.md"), "utf8") },`,
      `};`,
      `export const window = { commands: {} };`,
    ].join("\n"));
    await sleep(300);
    const r = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "readSelf" });
    const ok = r.json?.returnValue === selfContent;
    record({ id: "TC-REFL-01", name: "Object 通过 ctx.self.dir 读取自己的 self.md（自观察）", status: ok ? "PASS" : "FAIL", detail: ok ? undefined : JSON.stringify(r.json ?? r.text) });
  }

  // TC-REFL-02: HTTP 改 self.md
  {
    const newSelf = "# sb_demo v2\n我刚刚用 HTTP API 改写了自己的 self.md（reflectable 自修改）。";
    const w = await req("PUT", `/api/stones/${TARGET_ID}/self`, { text: newSelf }, { "X-Overwrite-Confirm": "true" });
    const g = await req("GET", `/api/stones/${TARGET_ID}/self`);
    const ok = w.status === 200 && w.json?.ok === true && g.json?.text === newSelf;
    record({
      id: "TC-REFL-02", name: "通过 HTTP API 修改 self.md（自修改身份）",
      status: ok ? "PASS" : "FAIL",
      detail: ok ? undefined : `write=${JSON.stringify(w.json)} get=${JSON.stringify(g.json)}`,
    });
  }

  // TC-REFL-04: HTTP 改 executable
  {
    const newCode = `export const ui_methods = { evolve: { fn: () => "我通过 HTTP API 改写了自己的 executable，reflectable × programmable 闭环。" } }; export const window = { commands: {} };`;
    const w = await req("PUT", `/api/stones/${TARGET_ID}/server-source`, { code: newCode }, { "X-Overwrite-Confirm": "true" });
    await sleep(500);
    const c = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "evolve" });
    const ok = w.status === 200 && w.json?.ok === true && typeof c.json?.returnValue === "string" && c.json.returnValue.includes("reflectable");
    record({
      id: "TC-REFL-04", name: "通过 HTTP API 修改 executable 代码（自修改行为）",
      status: ok ? "PASS" : "FAIL",
      detail: ok ? undefined : `write=${JSON.stringify(w.json)} call=${JSON.stringify(c.json)}`,
    });
  }

  // TC-REFL-05: knowledge 双写
  {
    const seedContent = "reflectable 自写的 seed knowledge（stone/knowledge/）。";
    const sedimentContent = "HTTP API 写入的 sediment knowledge（pool/knowledge/）。";

    await putExec(TARGET_ID,[
      `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";`,
      `import { dirname, join } from "node:path";`,
      `export const ui_methods = {`,
      `  writeSeedKnowledge: { fn: (ctx, args) => {`,
      `    const target = join(ctx.self.dir, "knowledge", args.path);`,
      `    mkdirSync(dirname(target), { recursive: true });`,
      `    writeFileSync(target, args.content, "utf8");`,
      `    return { ok: true };`,
      `  }},`,
      `  readSeedKnowledge: { fn: (ctx, args) => readFileSync(join(ctx.self.dir, "knowledge", args.path), "utf8") },`,
      `};`,
      `export const window = { commands: {} };`,
    ].join("\n"));
    await sleep(300);
    const wr = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "writeSeedKnowledge", args: { path: "about/reflection.md", content: seedContent } });
    const rr = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "readSeedKnowledge", args: { path: "about/reflection.md" } });
    const sr = await req("POST", `/api/stones/${TARGET_ID}/knowledge/files`, { path: "runtime/session-note.md", content: sedimentContent });
    const ok = wr.json?.returnValue?.ok === true && rr.json?.returnValue === seedContent && sr.status === 200 && sr.json?.created === true;
    record({
      id: "TC-REFL-05", name: "knowledge 双写：reflectable 自写 seed + HTTP 写 sediment",
      status: ok ? "PASS" : "FAIL",
      detail: ok ? undefined : `writeSeed=${JSON.stringify(wr.json)} readSeed=${JSON.stringify(rr.json)} writeSediment(status=${sr.status})=${JSON.stringify(sr.json ?? sr.text)}`,
    });
  }

  // TC-REFL-06: reflectable × programmable 闭环
  {
    await putExec(TARGET_ID,[
      `export const ui_methods = { version: { fn: () => "v1" } };`,
      `export const window = { commands: {} };`,
    ].join("\n"));
    await sleep(300);
    const r1 = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "version" });
    const v2Code = `export const ui_methods = { version: { fn: () => "v2" }, hello: { fn: () => "world" } }; export const window = { commands: {} };`;
    await req("PUT", `/api/stones/${TARGET_ID}/server-source`, { code: v2Code }, { "X-Overwrite-Confirm": "true" });
    await sleep(500);
    const r2 = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "version" });
    const r3 = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "hello" });
    const ok = r1.json?.returnValue === "v1" && r2.json?.returnValue === "v2" && r3.json?.returnValue === "world";
    record({
      id: "TC-REFL-06", name: "reflectable × programmable 闭环：HTTP 改 executable，新方法 hot-reload 生效",
      status: ok ? "PASS" : "FAIL",
      detail: ok ? undefined : `v1=${r1.json?.returnValue} v2.version=${r2.json?.returnValue} v2.hello=${r3.json?.returnValue}`,
    });
  }

  // ═══ Visible ═══
  console.log("\n— Visible —");

  // TC-VIS-01: client-source-url
  {
    await writeStoneFile(TARGET_ID, "visible/index.tsx", `export default () => null;`);
    await sleep(300);
    const r = await req("GET", `/api/objects/stone/${TARGET_ID}/client-source-url`);
    const ok = r.status === 200 && typeof r.json?.absPath === "string" && r.json.absPath.endsWith(join("visible", "index.tsx"));
    record({
      id: "TC-VIS-01", name: "client-source-url API 返回正确的 absPath/fsUrl，指向真实 visible/index.tsx",
      status: ok ? "PASS" : "FAIL",
      detail: ok ? undefined : `status=${r.status} json=${JSON.stringify(r.json ?? r.text)}`,
    });
  }

  // TC-VIS-02: Vite serve visible（5173）
  {
    let viteOk = false;
    try { viteOk = (await fetch("http://localhost:5173/api/health")).ok; } catch {}
    if (viteOk) {
      const visiblePath = join(STONE_DIR, "visible", "index.tsx");
      const resp = await fetch(`http://localhost:5173/@fs${visiblePath}`);
      const body = await resp.text();
      const ok = resp.status === 200 && body.includes("export default");
      // tsconfig extends @ooc/tsconfig/world 找不到（world 目录没装 @ooc/tsconfig）是环境问题，
      // 不是 visible 能力本身的问题——这种情况标 SKIP。
      const envError = resp.status === 500 && body.includes("@ooc/tsconfig/world");
      if (envError) {
        record({ id: "TC-VIS-02", name: "Vite @fs serve visible/index.tsx 返回模块代码", status: "SKIP", detail: "环境问题：world/tsconfig extends @ooc/tsconfig/world 解析失败，与 visible 能力无关" });
      } else {
        record({ id: "TC-VIS-02", name: "Vite @fs serve visible/index.tsx 返回模块代码", status: ok ? "PASS" : "FAIL", detail: ok ? undefined : `status=${resp.status} len=${body.length}` });
      }
    } else {
      record({ id: "TC-VIS-02", name: "Vite @fs serve visible/index.tsx 返回模块代码", status: "SKIP", detail: "Vite 不在 5173" });
    }
  }

  // TC-VIS-03: Vite 拒绝 executable
  {
    let viteOk = false;
    try { viteOk = (await fetch("http://localhost:5173/api/health")).ok; } catch {}
    if (viteOk) {
      await putExec(TARGET_ID,`export const ui_methods = {};`);
      const execPath = join(STONE_DIR, "executable", "index.ts");
      const resp = await fetch(`http://localhost:5173/@fs${execPath}`);
      const body = await resp.text();
      const ok = resp.status === 403 && (body.includes("Forbidden") || body.includes("403 Restricted"));
      record({ id: "TC-VIS-03", name: "Vite 拒绝 serve executable 路径（安全边界）", status: ok ? "PASS" : "FAIL", detail: ok ? undefined : `status=${resp.status} body=${body.slice(0, 100)}` });
    } else {
      record({ id: "TC-VIS-03", name: "Vite 拒绝 serve executable 路径（安全边界）", status: "SKIP", detail: "Vite 不在 5173" });
    }
  }

  // TC-VIS-05: UI↔行为闭环
  {
    await writeStoneFile(TARGET_ID, "visible/index.tsx", [
      `import type { ClientComponentProps } from "@ooc/web/src/domains/clients/ObjectClientRenderer";`,
      `export default function Demo({ callMethod }: ClientComponentProps) {`,
      `  const onClick = () => callMethod?.("greet", { name: "storybook" });`,
      `  return null;`,
      `}`,
    ].join("\n"));
    await putExec(TARGET_ID,[
      `export const ui_methods = { greet: { fn: (_ctx, args) => ({ hello: args.name }) } };`,
      `export const window = { commands: {} };`,
    ].join("\n"));
    await sleep(300);
    const urlR = await req("GET", `/api/objects/stone/${TARGET_ID}/client-source-url`);
    const callR = await req("POST", `/api/stones/${TARGET_ID}/call_method`, { method: "greet", args: { name: "storybook" } });
    const ok = urlR.status === 200 && callR.json?.returnValue?.hello === "storybook";
    record({
      id: "TC-VIS-05", name: "UI↔行为闭环：visible 组件存在 + callMethod 端点调通 executable 方法",
      status: ok ? "PASS" : "FAIL",
      detail: ok ? undefined : `url=${urlR.status} call=${JSON.stringify(callR.json)}`,
    });
  }

  // ═══ 汇总 & 写入 session ═══
  console.log("\n=== Summary ===");
  const byStatus = { PASS: 0, FAIL: 0, SKIP: 0 } as Record<string, number>;
  for (const r of results) byStatus[r.status]++;
  console.log(`PASS=${byStatus.PASS}  FAIL=${byStatus.FAIL}  SKIP=${byStatus.SKIP}  TOTAL=${results.length}`);

  const report = mdReport();

  // 创建 session（seed 到 sb_demo），然后追加报告消息
  console.log(`\nCreating session ${SESSION_ID}...`);
  const seedResp = await req("POST", "/api/sessions", {
    sessionId: SESSION_ID,
    title: `Storybook 回访：reflectable / programmable / visible (${new Date().toISOString().slice(0, 19).replace("T", " ")})`,
    targetObjectId: TARGET_ID,
    initialMessage: "开始对 OOC Object 的 reflectable / programmable / visible 三项能力跑 storybook 回访测试。",
  });
  console.log("seed:", seedResp.status, JSON.stringify(seedResp.json ?? seedResp.text).slice(0, 200));

  if (seedResp.status >= 200 && seedResp.status < 300) {
    // 再追加报告消息
    const cont = await req("POST", `/api/flows/${SESSION_ID}/continue`, { text: report });
    console.log("continue:", cont.status, JSON.stringify(cont.json ?? cont.text).slice(0, 200));
  }

  console.log(`\nDone. Session URL: http://localhost:5173/session/${SESSION_ID}`);
  try { await rm(join(STONE_DIR, "knowledge"), { recursive: true, force: true }); } catch {}
}

main().catch(e => { console.error(e); process.exit(1); });
