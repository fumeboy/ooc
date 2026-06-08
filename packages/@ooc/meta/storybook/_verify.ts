/**
 * meta/storybook 测试用例验证脚本。
 *
 * 对当前运行的 OOC World（默认 http://localhost:3000 + http://localhost:5173）
 * 执行可编程/可反思/可见三个能力的测试，输出结构化结果。
 *
 * 运行：
 *   bun run packages/@ooc/meta/storybook/_verify.ts
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureStoneRepo, stoneDir as realStoneDir } from "@ooc/core/persistable";
import { readServerConfig } from "@ooc/core/app/server/bootstrap/config";
import { buildServer } from "@ooc/core/app/server/index";

const BACKEND_PORT = 3499;
const FRONTEND_PORT = 5173; // 实际上不用 Vite，用已经在跑的也行；这里我们自建 backend，Vite 调现有服务

type Result = {
  id: string;
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
};

const results: Result[] = [];

function record(r: Result) {
  results.push(r);
  const mark = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⬜";
  console.log(`${mark} ${r.id}  ${r.name}`);
  if (r.detail) console.log(`     ${r.detail}`);
}

async function assertEq(label: string, actual: any, expected: any, tcId: string, tcName: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record({
    id: tcId,
    name: tcName,
    status: ok ? "PASS" : "FAIL",
    detail: ok ? undefined : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  });
  return ok;
}

async function main() {
  // ── setup: 自建一个独立 world，不和当前运行的 world 冲突 ──
  const worldDir = await mkdtemp(join(tmpdir(), "ooc-storybook-"));
  console.log(`\n=== Storybook verification ===`);
  console.log(`world: ${worldDir}`);
  await ensureStoneRepo({ baseDir: worldDir });
  const config = {
    ...(await readServerConfig()),
    port: BACKEND_PORT,
    baseDir: worldDir,
    workerEnabled: false,
    dev: true,
  };
  const app = buildServer(config);
  // Elysia handle 模式不需要实际 listen — 直接 app.handle
  const base = `http://localhost:${BACKEND_PORT}`;

  async function postJson(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<any> {
    const resp = await app.handle(
      new Request(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      }),
    );
    const text = await resp.text();
    try { return { status: resp.status, json: JSON.parse(text), text }; } catch { return { status: resp.status, text }; }
  }

  async function putJson(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<any> {
    const resp = await app.handle(
      new Request(`${base}${path}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      }),
    );
    const text = await resp.text();
    try { return { status: resp.status, json: JSON.parse(text), text }; } catch { return { status: resp.status, text }; }
  }

  async function getJson(path: string): Promise<any> {
    const resp = await app.handle(new Request(`${base}${path}`));
    const text = await resp.text();
    try { return { status: resp.status, json: JSON.parse(text), text }; } catch { return { status: resp.status, text }; }
  }

  // Helper: 把文件写入实际磁盘上的 stone 目录。
  // canonical 现为 versioning 布局 `stones/main/objects/<id>/`（worktree 模型，2026-06；
  // 旧 flat `stones/<id>/` 已废弃）。直接复用 runtime 的 stoneDir 解析，避免布局漂移。
  function stoneDir(id: string): string {
    return realStoneDir({ baseDir: worldDir, objectId: id });
  }
  async function writeStoneFile(id: string, relPath: string, content: string): Promise<string> {
    const full = join(stoneDir(id), relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
    return full;
  }

  // ═══════════════════════════════════════════════════════════
  // CAPABILITY 1: Programmable
  // ═══════════════════════════════════════════════════════════
  console.log("\n— Programmable —");

  // TC-PROG-01
  {
    const id = "echo_agent";
    await postJson("/api/stones", { objectId: id });
    await writeStoneFile(id, "executable/index.ts", [
      `export const ui_methods = {`,
      `  echo: { description: "echoes args.text", fn: (ctx, args) => ({ youSaid: args.text }) },`,
      `};`,
      `export const window = { methods: {} };`,
    ].join("\n"));
    await sleep(250); // hot-reload debounce
    const r = await postJson(`/api/stones/${id}/call_method`, { method: "echo", args: { text: "hello" } });
    await assertEq("returnValue", r.json?.returnValue, { youSaid: "hello" },
      "TC-PROG-01", "ui_methods 通过 HTTP 调用返回正确值");
  }

  // TC-PROG-02
  {
    const id = "dir_checker";
    await postJson("/api/stones", { objectId: id });
    await writeStoneFile(id, "executable/index.ts", [
      `import { statSync } from "node:fs";`,
      `export const ui_methods = {`,
      `  getMyDir: { fn: (ctx) => ({ myDir: ctx.self.dir, exists: (() => { try { return statSync(ctx.self.dir).isDirectory(); } catch { return false; } })() }) },`,
      `};`,
      `export const window = { methods: {} };`,
    ].join("\n"));
    await sleep(250);
    const r = await postJson(`/api/stones/${id}/call_method`, { method: "getMyDir" });
    const myDir: string = r.json?.returnValue?.myDir ?? "";
    const endsCorrect = myDir.endsWith(join("stones", "main", "objects", id)) || myDir.endsWith(join("stones", id));
    const exists = r.json?.returnValue?.exists === true;
    record({
      id: "TC-PROG-02",
      name: "方法拿到 ctx.self.dir（自己的 stone 路径）且目录真实存在",
      status: endsCorrect && exists ? "PASS" : "FAIL",
      detail: endsCorrect && exists ? undefined : `myDir=${myDir}, endsCorrect=${endsCorrect}, exists=${exists}`,
    });
  }

  // TC-PROG-03 — loadObjectWindow loader API
  {
    const id = "cmd_demo";
    await postJson("/api/stones", { objectId: id });
    await writeStoneFile(id, "executable/index.ts", [
      `export const window = { methods: { greet: { paths: ["greet"], intent: () => [], exec: async (_ctx: any) => ({ reply: "hi" }) } } };`,
      `export const ui_methods = {};`,
    ].join("\n"));
    await sleep(250);

    const { loadObjectWindow } = await import("@ooc/core/runtime/server-loader");
    const win = await loadObjectWindow({ baseDir: worldDir, objectId: id });
    const hasGreet = !!win?.methods?.greet;
    const pathsOk = JSON.stringify(win?.methods?.greet?.paths) === JSON.stringify(["greet"]);
    record({
      id: "TC-PROG-03",
      name: "window.methods（LLM 路径自定义命令）可通过 loader 加载",
      status: hasGreet && pathsOk ? "PASS" : "FAIL",
      detail: hasGreet && pathsOk ? undefined : `hasGreet=${hasGreet}, paths=${JSON.stringify(win?.methods?.greet?.paths)}`,
    });
  }

  // TC-PROG-04
  {
    const id = "hot_prog";
    await postJson("/api/stones", { objectId: id });
    // v1
    await writeStoneFile(id, "executable/index.ts", [
      `export const ui_methods = { ping: { fn: () => "v1" } };`,
      `export const window = { methods: {} };`,
    ].join("\n"));
    await sleep(250);
    const r1 = await postJson(`/api/stones/${id}/call_method`, { method: "ping" });
    const v1Ok = r1.json?.returnValue === "v1";
    // v2
    await writeStoneFile(id, "executable/index.ts", [
      `export const ui_methods = { ping: { fn: () => "v2" }, pong: { fn: () => "pong" } };`,
      `export const window = { methods: {} };`,
    ].join("\n"));
    await sleep(500);
    const r2 = await postJson(`/api/stones/${id}/call_method`, { method: "ping" });
    const r3 = await postJson(`/api/stones/${id}/call_method`, { method: "pong" });
    const v2Ok = r2.json?.returnValue === "v2" && r3.json?.returnValue === "pong";
    record({
      id: "TC-PROG-04",
      name: "热更新 — 修改 executable 后已有方法变更、新增方法立即生效",
      status: v1Ok && v2Ok ? "PASS" : "FAIL",
      detail: v1Ok && v2Ok ? undefined : `ping(v1)=${r1.json?.returnValue}, ping(v2)=${r2.json?.returnValue}, pong(v2)=${r3.json?.returnValue}`,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CAPABILITY 2: Reflectable
  // ═══════════════════════════════════════════════════════════
  console.log("\n— Reflectable —");

  // TC-REFL-01
  {
    const id = "mirror";
    const selfContent = "# Mirror\nI am a reflective agent";
    // 注：全部经 HTTP API 写入，统一走 worktree 版本化（main = canonical）。
    // 不直写磁盘——直写未提交会和后续 REFL-02/04 的 worktree ff-merge 冲突（新系统设计）。
    await postJson("/api/stones", { objectId: id, self: selfContent });
    await putJson(`/api/stones/${id}/server-source`, {
      code: [
        `import { readFileSync } from "node:fs";`,
        `import { join } from "node:path";`,
        `export const ui_methods = {`,
        `  readSelf: { fn: (ctx) => readFileSync(join(ctx.self.dir, "self.md"), "utf8") },`,
        `};`,
        `export const window = { methods: {} };`,
      ].join("\n"),
    }, { "X-Overwrite-Confirm": "true" });
    await sleep(250);
    const r = await postJson(`/api/stones/${id}/call_method`, { method: "readSelf" });
    await assertEq("self.md content", r.json?.returnValue, selfContent,
      "TC-REFL-01", "Object 通过 ctx.self.dir 读取自己的 self.md（自观察）");
  }

  // TC-REFL-02
  {
    const id = "mirror";
    const newSelf = "# Mirror V2\nI evolved.";
    const r = await putJson(`/api/stones/${id}/self`, { text: newSelf }, { "X-Overwrite-Confirm": "true" });
    const writeOk = r.status === 200 && r.json?.ok === true;
    const r2 = await getJson(`/api/stones/${id}/self`);
    const getOk = r2.status === 200 && r2.json?.text === newSelf;
    const diskOk = readFileSync(join(stoneDir(id), "self.md"), "utf8") === newSelf;
    record({
      id: "TC-REFL-02",
      name: "通过 HTTP API 修改 self.md（自修改身份）",
      status: writeOk && getOk && diskOk ? "PASS" : "FAIL",
      detail: writeOk && getOk && diskOk ? undefined : `writeOk=${writeOk}, getOk=${getOk}, diskOk=${diskOk}`,
    });
  }

  // TC-REFL-03
  {
    const id = "mirror";
    const content = "对外介绍：我能反思自己。";
    const r = await putJson(`/api/stones/${id}/readme`, { text: content }, { "X-Overwrite-Confirm": "true" });
    const writeOk = r.status === 200 && r.json?.ok === true;
    const r2 = await getJson(`/api/stones/${id}/readme`);
    const getOk = r2.status === 200 && r2.json?.text === content;
    // readable.md 也会被双写（writeReadable 双写 readme.md）。我们只验证 API 侧即可。
    record({
      id: "TC-REFL-03",
      name: "通过 HTTP API 修改 readable（自修改对外呈现）",
      status: writeOk && getOk ? "PASS" : "FAIL",
      detail: writeOk && getOk ? undefined : `writeOk=${writeOk}, getOk=${getOk}, text=${r2.json?.text ?? r2.text}`,
    });
  }

  // TC-REFL-04
  {
    const id = "mirror";
    const newCode = `export const ui_methods = { evolve: { fn: () => "I changed myself!" } }; export const window = { methods: {} };`;
    const r = await putJson(`/api/stones/${id}/server-source`, { code: newCode }, { "X-Overwrite-Confirm": "true" });
    const writeOk = r.status === 200 && r.json?.ok === true;
    await sleep(400);
    const r2 = await postJson(`/api/stones/${id}/call_method`, { method: "evolve" });
    const callOk = r2.json?.returnValue === "I changed myself!";
    record({
      id: "TC-REFL-04",
      name: "通过 HTTP API 修改 executable 代码（自修改行为）",
      status: writeOk && callOk ? "PASS" : "FAIL",
      detail: writeOk && callOk ? undefined : `writeOk=${writeOk}, status=${r2.status}, returnValue=${JSON.stringify(r2.json?.returnValue)}`,
    });
  }

  // TC-REFL-05
  // OOC knowledge 分两层（object.doc.ts persistable 维度）:
  //   - seed knowledge:     stones/<id>/knowledge/    (设计层，进 git review，reflectable 自写)
  //   - sediment knowledge: pools/<id>/knowledge/     (运行时沉淀层，HTTP API 写入)
  // Reflectable 意味着 Object 既能通过 ctx.self.dir 读写自己的 seed knowledge，
  // 也能通过 HTTP API 写入自己的 sediment knowledge。
  {
    const id = "mirror";
    const seedContent = "反思是能力的起点。（seed knowledge，reflectable 自写）";
    const sedimentContent = "运行中积累的知识。（sediment knowledge，HTTP API 写入）";

    // 1. Reflectable 自写 seed knowledge: 通过 executable 方法写 ctx.self.dir/knowledge/
    await writeStoneFile(id, "executable/index.ts", [
      `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";`,
      `import { dirname, join } from "node:path";`,
      `export const ui_methods = {`,
      `  writeSeedKnowledge: { fn: (ctx, args: any) => {`,
      `    const target = join(ctx.self.dir, "knowledge", args.path);`,
      `    mkdirSync(dirname(target), { recursive: true });`,
      `    writeFileSync(target, args.content, "utf8");`,
      `    return { ok: true };`,
      `  }},`,
      `  readSeedKnowledge: { fn: (ctx, args: any) => readFileSync(join(ctx.self.dir, "knowledge", args.path), "utf8") },`,
      `};`,
      `export const window = { methods: {} };`,
    ].join("\n"));
    await sleep(250);

    const wr = await postJson(`/api/stones/${id}/call_method`, {
      method: "writeSeedKnowledge",
      args: { path: "about/reflection.md", content: seedContent },
    });
    const writeSeedOk = wr.json?.returnValue?.ok === true;

    // seed 文件真实落盘到 stone/knowledge/
    const seedPath = join(stoneDir(id), "knowledge", "about", "reflection.md");
    const seedDiskOk = existsSync(seedPath) && readFileSync(seedPath, "utf8") === seedContent;

    // reflectable 回读 seed knowledge
    const rr = await postJson(`/api/stones/${id}/call_method`, {
      method: "readSeedKnowledge",
      args: { path: "about/reflection.md" },
    });
    const readSeedOk = rr.json?.returnValue === seedContent;

    // 2. HTTP API 写 sediment knowledge（pool 层）
    const { poolKnowledgeDir } = await import("@ooc/core/persistable");
    const sr = await postJson(`/api/stones/${id}/knowledge/files`, {
      path: "runtime/session-note.md",
      content: sedimentContent,
    });
    const sedimentCreateOk = sr.status === 200 && sr.json?.created === true;
    const sedimentDiskPath = join(poolKnowledgeDir({ baseDir: worldDir, objectId: id }), "runtime", "session-note.md");
    const sedimentDiskOk = existsSync(sedimentDiskPath) && readFileSync(sedimentDiskPath, "utf8") === sedimentContent;

    record({
      id: "TC-REFL-05",
      name: "knowledge 双写：reflectable 自写 seed（stone/knowledge） + HTTP 写 sediment（pool/knowledge）",
      status: writeSeedOk && seedDiskOk && readSeedOk && sedimentCreateOk && sedimentDiskOk ? "PASS" : "FAIL",
      detail: writeSeedOk && seedDiskOk && readSeedOk && sedimentCreateOk && sedimentDiskOk
        ? undefined
        : `writeSeedOk=${writeSeedOk}, seedDiskOk=${seedDiskOk}, readSeedOk=${readSeedOk}, sedimentCreateOk=${sedimentCreateOk}, sedimentDiskOk=${sedimentDiskOk}`,
    });
  }

  // TC-REFL-06 — reflectable + programmable 闭环：通过 PUT server-source 改自己，新方法立即生效
  {
    const id = "morph";
    await postJson("/api/stones", { objectId: id });
    // 初始 executable 也经 HTTP API 写（统一走 worktree；直写未提交会和后续 PUT 冲突）。
    await putJson(`/api/stones/${id}/server-source`, {
      code: [
        `export const ui_methods = { version: { fn: () => "v1" } };`,
        `export const window = { methods: {} };`,
      ].join("\n"),
    }, { "X-Overwrite-Confirm": "true" });
    await sleep(200);
    const r1 = await postJson(`/api/stones/${id}/call_method`, { method: "version" });
    const v1Ok = r1.json?.returnValue === "v1";

    const v2Code = `export const ui_methods = { version: { fn: () => "v2" }, hello: { fn: () => "world" } }; export const window = { methods: {} };`;
    await putJson(`/api/stones/${id}/server-source`, { code: v2Code }, { "X-Overwrite-Confirm": "true" });
    await sleep(400);

    const r2 = await postJson(`/api/stones/${id}/call_method`, { method: "version" });
    const r3 = await postJson(`/api/stones/${id}/call_method`, { method: "hello" });
    const v2Ok = r2.json?.returnValue === "v2" && r3.json?.returnValue === "world";
    record({
      id: "TC-REFL-06",
      name: "reflectable × programmable 闭环：HTTP 改 executable，新方法通过 hot-reload 立即注册",
      status: v1Ok && v2Ok ? "PASS" : "FAIL",
      detail: v1Ok && v2Ok ? undefined : `v1=${r1.json?.returnValue}, v2.version=${r2.json?.returnValue}, v2.hello=${r3.json?.returnValue}`,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CAPABILITY 3: Visible
  // ═══════════════════════════════════════════════════════════
  console.log("\n— Visible —");

  // TC-VIS-01
  {
    const id = "ui_demo";
    await postJson("/api/stones", { objectId: id });
    const visiblePath = await writeStoneFile(id, "visible/index.tsx", `export default () => null;`);
    const r = await getJson(`/api/objects/stone/${id}/client-source-url`);
    const ok = r.status === 200
      && typeof r.json?.absPath === "string"
      && r.json.absPath.endsWith(join("visible", "index.tsx"))
      && r.json?.fsUrl === `/@fs${r.json.absPath}`;
    const absPath = r.json?.absPath ?? "";
    const exists = existsSync(absPath);
    record({
      id: "TC-VIS-01",
      name: "client-source-url API 返回正确的 absPath 和 fsUrl，指向真实存在的文件",
      status: ok && exists ? "PASS" : "FAIL",
      detail: ok && exists ? undefined : `status=${r.status}, absPath=${absPath}, exists=${exists}, fsUrl=${r.json?.fsUrl}`,
    });
  }

  // TC-VIS-02 — Vite 能 serve /@fs/ 下的 visible 组件。
  // 只有当脚本的 worldDir 恰好就是 Vite 正在 serve 的 worldRoot 时才测；否则 SKIP（Vite fs.allow 不会放行脚本临时目录）。
  {
    let viteOk = false;
    let viteWorldRoot: string | null = null;
    try {
      const probe = await fetch("http://localhost:5173/api/health", { redirect: "manual" });
      viteOk = probe.ok;
      if (viteOk) {
        // 从 /api/stones 推断 Vite 的 worldRoot = dirname(dirname(dirname(item.dir))) 当 stones/<branch>/objects/<id>
        const stones = await (await fetch("http://localhost:5173/api/stones")).json() as { items?: { dir: string }[] };
        const d = stones?.items?.[0]?.dir;
        if (d) {
          // /.../stones/<branch>/objects/<id>  → worldRoot 是 stones 之前的部分
          const idx = d.indexOf("/stones/");
          if (idx >= 0) viteWorldRoot = d.slice(0, idx);
        }
      }
    } catch { viteOk = false; }

    if (viteOk && viteWorldRoot && viteWorldRoot === worldDir) {
      const id = "ui_demo";
      const visiblePath = join(stoneDir(id), "visible", "index.tsx");
      const viteResp = await fetch(`http://localhost:5173/@fs${visiblePath}`);
      const status = viteResp.status;
      const body = await viteResp.text();
      const ok = status === 200 && body.includes("export default");
      record({
        id: "TC-VIS-02",
        name: "Vite serve /@fs/<absPath>/visible/index.tsx 返回模块代码",
        status: ok ? "PASS" : "FAIL",
        detail: ok ? undefined : `status=${status}, body.len=${body.length}`,
      });
    } else {
      const reason = !viteOk
        ? "Vite 不在 5173 端口运行"
        : `Vite worldRoot (${viteWorldRoot ?? "unknown"}) 与脚本 worldDir (${worldDir}) 不一致，Vite fs.allow 不会放行`;
      record({ id: "TC-VIS-02", name: "Vite serve visible 组件", status: "SKIP", detail: reason });
    }
  }

  // TC-VIS-03 — Vite 拒绝 executable/knowledge 路径（安全边界）。
  // 同 TC-VIS-02：仅当脚本 worldDir === Vite worldRoot 时实测，否则 SKIP。
  {
    let viteRunning = false;
    let viteWorldRoot: string | null = null;
    try {
      viteRunning = (await fetch("http://localhost:5173/api/health")).ok;
      if (viteRunning) {
        const stones = await (await fetch("http://localhost:5173/api/stones")).json() as { items?: { dir: string }[] };
        const d = stones?.items?.[0]?.dir;
        if (d) {
          const idx = d.indexOf("/stones/");
          if (idx >= 0) viteWorldRoot = d.slice(0, idx);
        }
      }
    } catch {}

    if (viteRunning && viteWorldRoot && viteWorldRoot === worldDir) {
      const id = "ui_demo";
      const execPath = join(stoneDir(id), "executable", "index.ts");
      await writeStoneFile(id, "executable/index.ts", `export const ui_methods = {};`);
      const resp = await fetch(`http://localhost:5173/@fs${execPath}`);
      const status = resp.status;
      const body = await resp.text();
      // 403 +（我们插件返回 Forbidden，或 Vite fs.allow 返回 Restricted）都算通过
      const forbidden = status === 403 && (body.includes("Forbidden") || body.includes("403 Restricted"));
      record({
        id: "TC-VIS-03",
        name: "Vite 拒绝 serve executable 路径（§7.3 安全边界）",
        status: forbidden ? "PASS" : "FAIL",
        detail: forbidden ? undefined : `status=${status}, body=${body.slice(0, 120)}`,
      });
    } else {
      const reason = !viteRunning
        ? "Vite 不在 5173 运行"
        : `Vite worldRoot (${viteWorldRoot ?? "unknown"}) 与脚本 worldDir (${worldDir}) 不一致，跳过`;
      record({ id: "TC-VIS-03", name: "Vite 安全边界 — 拒绝 executable", status: "SKIP", detail: reason });
    }
  }

  // TC-VIS-04 — Vite HMR on visible change (通过后端 hot-reload watcher + registry event 验证，
  // 浏览器端 HMR 需要真实浏览器，这里验证 fs change → stone:changed kind=view 事件触发即可)
  {
    const id = "hmr_demo";
    await postJson("/api/stones", { objectId: id });
    const runtime = (app.store as any).runtime;

    // 先把 stone 初始化的 identity 事件 flush 掉（创建 stone 时多个文件一起落盘会先触发 identity）
    await sleep(500);
    let caught: any = null;
    const off = runtime.stoneRegistry.on("stone:changed", (ev: any) => {
      if (ev.objectId === id) caught = ev;
    });

    await writeStoneFile(id, "visible/index.tsx", `export default () => 'v1';`);
    await sleep(400);
    const v1 = caught;
    caught = null;

    await writeStoneFile(id, "visible/index.tsx", `export default () => 'v2';`);
    await sleep(400);
    const v2 = caught;
    off();

    const ok = v1?.kind === "view" && v1?.objectId === id
      && v2?.kind === "view" && v2?.objectId === id
      && Array.isArray(v1?.files) && v1.files.length > 0;
    record({
      id: "TC-VIS-04",
      name: "visible/index.tsx 变更触发 stone:changed kind=view 事件（Vite HMR 的后端侧信号）",
      status: ok ? "PASS" : "FAIL",
      detail: ok ? undefined : `v1=${JSON.stringify(v1)}, v2=${JSON.stringify(v2)}`,
    });
  }

  // TC-VIS-05 — UI↔行为闭环：visible 组件 props.callMethod 实际能调通 executable 方法
  // 浏览器端场景，用"client-source-url 正确 + call_method HTTP 端点独立验证"组合验证。
  {
    const id = "ui_loop";
    await postJson("/api/stones", { objectId: id });
    await writeStoneFile(id, "visible/index.tsx", [
      `import type { ClientComponentProps } from "@ooc/web/src/domains/clients/ObjectClientRenderer";`,
      `export default function Demo({ callMethod }: ClientComponentProps) {`,
      `  const onClick = () => callMethod?.("greet", { name: "ooc" });`,
      `  return null;`,
      `}`,
    ].join("\n"));
    await writeStoneFile(id, "executable/index.ts", [
      `export const ui_methods = { greet: { fn: (_ctx, args) => ({ hello: args.name }) } };`,
      `export const window = { methods: {} };`,
    ].join("\n"));
    await sleep(250);

    const urlResp = await getJson(`/api/objects/stone/${id}/client-source-url`);
    const urlOk = urlResp.status === 200;

    // 独立验证 call_method 端点（前端 callMethod props 内部就是 POST 到这个端点）
    const callResp = await postJson(`/api/stones/${id}/call_method`, { method: "greet", args: { name: "ooc" } });
    const callOk = callResp.json?.returnValue?.hello === "ooc";

    record({
      id: "TC-VIS-05",
      name: "UI↔行为闭环：visible 组件存在 + callMethod 端点可调用对应 executable 方法",
      status: urlOk && callOk ? "PASS" : "FAIL",
      detail: urlOk && callOk ? undefined : `urlOk=${urlOk}(${urlResp.status}), callOk=${callOk}(${JSON.stringify(callResp.json?.returnValue)})`,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CAPABILITY 4: Class（2026-06-07 新增 —— class 一等继承抽象）
  // ═══════════════════════════════════════════════════════════
  console.log("\n— Class —");

  // TC-CLASS-01: instantiate_with_new_world —— builtin class 幂等实例化为 objects/ object
  {
    const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
    const res = await instantiateBuiltinClassObjects({ baseDir: worldDir });
    const dir = realStoneDir({ baseDir: worldDir, objectId: "supervisor" });
    const pkgOk = existsSync(join(dir, "package.json"))
      && JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).ooc?.class === "_builtin/supervisor";
    const selfOk = existsSync(join(dir, "self.md")) && readFileSync(join(dir, "self.md"), "utf8").includes("总管");
    record({
      id: "TC-CLASS-01",
      name: "instantiate_with_new_world：supervisor class 幂等实例化为 objects/ object（拷贝 self.md + ooc.class）",
      status: res.instantiated.includes("supervisor") && pkgOk && selfOk ? "PASS" : "FAIL",
      detail: res.instantiated.includes("supervisor") && pkgOk && selfOk ? undefined
        : `instantiated=${JSON.stringify(res.instantiated)}, pkgOk=${pkgOk}, selfOk=${selfOk}`,
    });
  }

  // TC-CLASS-02: 幂等 —— 二次实例化跳过、不覆盖用户改动
  {
    const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
    const dir = realStoneDir({ baseDir: worldDir, objectId: "supervisor" });
    writeFileSync(join(dir, "self.md"), "# 用户改过的 supervisor", "utf8");
    const res = await instantiateBuiltinClassObjects({ baseDir: worldDir });
    const preserved = readFileSync(join(dir, "self.md"), "utf8").includes("用户改过");
    record({
      id: "TC-CLASS-02",
      name: "实例化幂等：二次 bootstrap 跳过已存在 instance，保住用户改动",
      status: res.skipped.includes("supervisor") && preserved ? "PASS" : "FAIL",
      detail: res.skipped.includes("supervisor") && preserved ? undefined
        : `skipped=${JSON.stringify(res.skipped)}, preserved=${preserved}`,
    });
  }

  // TC-CLASS-03: instance 经 class 链继承框架 class 的 seed knowledge
  {
    const { loadKnowledgeIndex } = await import("@ooc/core/thinkable/knowledge/loader");
    const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
    const reg = createObjectRegistry();
    reg.registerNewObjectType("_builtin/supervisor" as any, { methods: {} });
    reg.registerNewObjectType("supervisor" as any, { methods: {}, parentClass: "_builtin/supervisor" });
    const idx = await loadKnowledgeIndex(
      { stone: { baseDir: worldDir, objectId: "supervisor" }, pool: { baseDir: worldDir, objectId: "supervisor" } }, reg);
    const paths = [...idx.byPath.keys()];
    const inherits = paths.some((p) => p.includes("eight-dimensions")) && paths.some((p) => p.includes("world-vocabulary"));
    record({
      id: "TC-CLASS-03",
      name: "instance 经 class 链继承框架 class 的 seed knowledge（eight-dimensions / world-vocabulary）",
      status: inherits ? "PASS" : "FAIL",
      detail: inherits ? undefined : `inherited paths=${JSON.stringify(paths)}`,
    });
  }

  // TC-CLASS-04: class 不可交互 —— seedSession 拒绝 _builtin/ class 目标
  {
    const r = await postJson("/api/sessions", {
      sessionId: "tc-class-reject", targetObjectId: "_builtin/supervisor", initialMessage: "hi",
    });
    const rejected = r.status === 400 && /class/i.test(r.text ?? "");
    record({
      id: "TC-CLASS-04",
      name: "class 不可交互：seedSession 拒绝 _builtin/ class 作为对话目标",
      status: rejected ? "PASS" : "FAIL",
      detail: rejected ? undefined : `status=${r.status}, body=${(r.text ?? "").slice(0, 120)}`,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log("\n=== Summary ===");
  const byStatus = { PASS: 0, FAIL: 0, SKIP: 0 } as Record<string, number>;
  for (const r of results) byStatus[r.status]++;
  console.log(`PASS=${byStatus.PASS}  FAIL=${byStatus.FAIL}  SKIP=${byStatus.SKIP}  TOTAL=${results.length}`);

  // Write JSON results file（落在脚本同目录，不再硬编码绝对路径）
  const out = join(import.meta.dir, "_results.json");
  writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
  console.log(`Detailed results written to: ${relative(process.cwd(), out)}`);

  // cleanup — 显式调用 dispose
  try { await (app as any).onStop?.(); } catch {}
  try { await (app.store as any).runtime?.dispose?.(); } catch {}
  await rm(worldDir, { recursive: true, force: true });

  if (byStatus.FAIL > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
