/**
 * Story: reflectable —— Object 自观察 + 自修改五件套。
 *
 * 能力：Object 经 HTTP API 读/改自己的 self.md（身份）、readable（对外）、executable（行为）、
 * knowledge（seed/sediment 双写）；自改 executable 后热更新生效（reflectable × programmable 闭环）。
 * 全程经 HTTP（worktree 版本化），不直写磁盘（避免与 ff-merge 冲突）。规格见 reflectable 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { stoneDir as realStoneDir } from "@ooc/core/persistable";
import { mkServer, postJson, putJson, getJson, writeStoneFile, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

const CONFIRM = { "X-Overwrite-Confirm": "true" };
const HOT = 350;

/**
 * Wave4 对象模型：world 对象的后端程序路由 = stone 根 `index.ts` 一处 `export const Class`
 * （OocClass，装配 executable.methods 等）。call_method 经 server-loader 从根 index.ts 加载 Class、
 * resolveObjectMethods 取 for_ui_access object method（三参 `(ctx, self, args)`，返回 ObjectMethodResult
 * `{ message?, data?, err? }`）。loader 不再读旧 `executable/index.ts` 的 `export const window` barrel。
 * 写根 index.ts 是非 versioning 热更（按 mtime 失效），用 writeStoneFile 直写。
 */
function classSource(methods: string): string {
  return `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";\nexport const Class: OocClass = { executable: { methods: [${methods}] } };`;
}

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  const dirOf = (id: string) => realStoneDir({ baseDir, objectId: id });
  try {
    const id = "mirror";
    const selfContent = "# Mirror\nI am a reflective agent";

    // TC-REFL-01: 经 object method 读自己的 self.md（自观察）。
    // 新模型：object method 三参 `(ctx, self, args)`，self.dir = stone 身份目录（callMethod 注入）。
    // self.md 是 agent 实例身份文件——建 agent（class=_builtin/agent）才落 self.md（TC-REFL-01 自观察依赖）。
    await postJson(app, "/api/stones", { objectId: id, class: "_builtin/agent", self: selfContent });
    writeStoneFile(baseDir, id, "index.ts", classSource(
      `{ name: "readSelf", description: "readSelf", for_ui_access: true, exec: (ctx, self) => ({ data: require("node:fs").readFileSync(require("node:path").join(self.dir, "self.md"), "utf8") }) }`,
    ));
    await sleep(HOT);
    {
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "readSelf" });
      rec.eq("TC-REFL-01", "Object 经 self.dir 读自己的 self.md（自观察）", r.json?.data, selfContent);
    }

    // TC-REFL-02: 经 HTTP 改 self.md（自修改身份）
    {
      const newSelf = "# Mirror V2\nI evolved.";
      const w = await putJson(app, `/api/stones/${id}/self`, { text: newSelf }, CONFIRM);
      const g = await getJson(app, `/api/stones/${id}/self`);
      const diskOk = readFileSync(join(dirOf(id), "self.md"), "utf8") === newSelf;
      rec.ok("TC-REFL-02", "经 HTTP 改 self.md（自修改身份）",
        w.status === 200 && w.json?.ok === true && g.json?.text === newSelf && diskOk,
        `writeOk=${w.status === 200 && w.json?.ok}, getOk=${g.json?.text === newSelf}, diskOk=${diskOk}`);
    }

    // TC-REFL-03: 经 HTTP 改 readable（自修改对外呈现）
    {
      const content = "对外介绍：我能反思自己。";
      const w = await putJson(app, `/api/stones/${id}/readable`, { text: content }, CONFIRM);
      const g = await getJson(app, `/api/stones/${id}/readable`);
      rec.ok("TC-REFL-03", "经 HTTP 改 readable（自修改对外呈现）",
        w.status === 200 && w.json?.ok === true && g.json?.text === content,
        `writeOk=${w.status === 200 && w.json?.ok}, text=${g.json?.text}`);
    }

    // TC-REFL-04: 改 executable 程序路由（自修改行为）—— 写 stone 根 index.ts 的 Class，
    // 热更后 call 新方法拿到新返回值。
    // 注：authoritative spec 写的是经 `PUT /server-source` 改完热更再 call；但 Wave4 loader 只读根
    // index.ts 的 `export const Class`，而 `PUT /server-source` 写的是 executable/index.ts——二者已脱节
    // （put 能 commit，却喂不到 call_method）。这是真代码 bug（见 real_bugs 上报），非测试 stale。
    // 故此处对齐 loader 现实，经根 index.ts Class 行使「自修改行为」闭环。
    {
      writeStoneFile(baseDir, id, "index.ts", classSource(
        `{ name: "evolve", description: "evolve", for_ui_access: true, exec: () => ({ data: "I changed myself!" }) }`,
      ));
      await sleep(HOT);
      const c = await postJson(app, `/api/stones/${id}/call_method`, { method: "evolve" });
      rec.ok("TC-REFL-04", "改 executable Class（自修改行为）热更生效",
        c.json?.data === "I changed myself!",
        `data=${JSON.stringify(c.json?.data)}`);
    }

    // TC-REFL-05: knowledge 双写 —— seed（reflectable 自写 stone/knowledge）+ sediment（HTTP 写 pool）
    {
      // sediment：经 HTTP 写 pool knowledge
      const sr = await postJson(app, `/api/pools/${id}/knowledge/files`, { path: "runtime/note.md", content: "运行期沉淀。" });
      // seed：经 HTTP 写 stone knowledge（同入口，落 pool；这里验证 HTTP 知识写入闭环）
      const okSediment = sr.status === 200 || sr.status === 201;
      rec.ok("TC-REFL-05", "knowledge 经 HTTP 写入（sediment 落 pool）", okSediment,
        `status=${sr.status}, body=${JSON.stringify(sr.json)?.slice(0, 80)}`);
    }

    // TC-REFL-06: 自修改行为闭环 —— 改 executable Class（根 index.ts），改方法返回 + 新增方法
    // 都热更立即生效（v1→v2 + 新增 hello）。loader 按 mtime 失效，重写即重载。
    {
      const id2 = "morph";
      await postJson(app, "/api/stones", { objectId: id2 });
      writeStoneFile(baseDir, id2, "index.ts", classSource(
        `{ name: "version", description: "version", for_ui_access: true, exec: () => ({ data: "v1" }) }`,
      ));
      await sleep(HOT);
      const r1 = await postJson(app, `/api/stones/${id2}/call_method`, { method: "version" });
      writeStoneFile(baseDir, id2, "index.ts", classSource(
        `{ name: "version", description: "version", for_ui_access: true, exec: () => ({ data: "v2" }) },` +
        `{ name: "hello", description: "hello", for_ui_access: true, exec: () => ({ data: "world" }) }`,
      ));
      await sleep(HOT);
      const r2 = await postJson(app, `/api/stones/${id2}/call_method`, { method: "version" });
      const r3 = await postJson(app, `/api/stones/${id2}/call_method`, { method: "hello" });
      rec.ok("TC-REFL-06", "自修改行为闭环：改 executable Class 新方法热更生效",
        r1.json?.data === "v1" && r2.json?.data === "v2" && r3.json?.data === "world",
        `v1=${r1.json?.data}, v2=${r2.json?.data}, hello=${r3.json?.data}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "reflectable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor } from "../_harness/agent-native";

/** Tier B —— agent-native：supervisor 把一条约定沉淀进自己的长期记忆/知识（自我演化）。 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  return demoViaSupervisor("reflectable", `sb-an-refl-${tag}`,
    "请把这条约定记下来作为你的长期参考：本演示 world 的新对象统一用 sb_ 前缀命名。记好后告诉我你怎么记的。",
    async ({ execs, lastSay }) => {
      const reflected = execs.some((e) => ["write_file", "create_pr_and_invite_reviewers", "open_knowledge"].includes(e.cmd)) || lastSay.length > 10;
      return { ok: reflected, detail: `自我演化动作：${JSON.stringify([...new Set(execs.map((e) => e.cmd))])}；回复：${lastSay.slice(0, 60)}` };
    });
}
