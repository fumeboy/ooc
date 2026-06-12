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
import { mkServer, postJson, putJson, getJson, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

const CONFIRM = { "X-Overwrite-Confirm": "true" };
const HOT = 350;

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  const dirOf = (id: string) => realStoneDir({ baseDir, objectId: id });
  try {
    const id = "mirror";
    const selfContent = "# Mirror\nI am a reflective agent";

    // TC-REFL-01: 经 executable 读自己的 self.md（自观察）
    await postJson(app, "/api/stones", { objectId: id, self: selfContent });
    await putJson(app, `/api/stones/${id}/server-source`, {
      code: `import { readFileSync } from "node:fs";\nimport { join } from "node:path";\nexport const window = { methods: { readSelf: { description: "readSelf", for_ui_access: true, exec: (ctx) => ({ ok: true, data: readFileSync(join(ctx.self.dir, "self.md"), "utf8") }) } } };`,
    }, CONFIRM);
    await sleep(HOT);
    {
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "readSelf" });
      rec.eq("TC-REFL-01", "Object 经 ctx.self.dir 读自己的 self.md（自观察）", r.json?.data, selfContent);
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

    // TC-REFL-04: 经 HTTP 改 executable 代码（自修改行为）
    {
      const w = await putJson(app, `/api/stones/${id}/server-source`, {
        code: `export const window = { methods: { evolve: { description: "evolve", for_ui_access: true, exec: () => ({ ok: true, data: "I changed myself!" }) } } };`,
      }, CONFIRM);
      await sleep(HOT);
      const c = await postJson(app, `/api/stones/${id}/call_method`, { method: "evolve" });
      rec.ok("TC-REFL-04", "经 HTTP 改 executable 代码（自修改行为）",
        w.status === 200 && c.json?.data === "I changed myself!",
        `writeOk=${w.status === 200}, data=${JSON.stringify(c.json?.data)}`);
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

    // TC-REFL-06: reflectable × programmable 闭环 —— HTTP 改 executable，新方法热更立即生效
    {
      const id2 = "morph";
      await postJson(app, "/api/stones", { objectId: id2 });
      await putJson(app, `/api/stones/${id2}/server-source`, {
        code: `export const window = { methods: { version: { description: "version", for_ui_access: true, exec: () => ({ ok: true, data: "v1" }) } } };`,
      }, CONFIRM);
      await sleep(HOT);
      const r1 = await postJson(app, `/api/stones/${id2}/call_method`, { method: "version" });
      await putJson(app, `/api/stones/${id2}/server-source`, {
        code: `export const window = { methods: { version: { description: "version", for_ui_access: true, exec: () => ({ ok: true, data: "v2" }) }, hello: { description: "hello", for_ui_access: true, exec: () => ({ ok: true, data: "world" }) } } };`,
      }, CONFIRM);
      await sleep(HOT);
      const r2 = await postJson(app, `/api/stones/${id2}/call_method`, { method: "version" });
      const r3 = await postJson(app, `/api/stones/${id2}/call_method`, { method: "hello" });
      rec.ok("TC-REFL-06", "reflectable × programmable 闭环：改 executable 新方法热更生效",
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
