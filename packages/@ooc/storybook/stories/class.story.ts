/**
 * Story: class —— 一等继承抽象。
 *
 * 能力：builtin class 经 instantiate_with_new_world 幂等实例化为 objects/ object（拷贝 self.md +
 * ooc.class）；二次实例化保用户改动；instance 经 class 链继承框架 seed knowledge；class 不可交互
 * （seedSession 拒绝 _builtin/ 目标）。规格见 class 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stoneDir as realStoneDir, resolveBuiltinReadDir } from "@ooc/core/persistable";
import { builtinRegistry } from "@ooc/core/runtime/object-registry";
import { injectMemberWindowsIfObjectThread, WindowManager } from "@ooc/core/executable/windows";
import { mkServer, postJson, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult, type TcResult } from "../_harness/types";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  const supDir = realStoneDir({ baseDir, objectId: "supervisor" });
  try {
    const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");

    // TC-CLASS-01: instantiate_with_new_world 幂等实例化 supervisor class → objects/ object
    {
      const res = await instantiateBuiltinClassObjects({ baseDir });
      const pkgOk = existsSync(join(supDir, "package.json"))
        && JSON.parse(readFileSync(join(supDir, "package.json"), "utf8")).ooc?.class === "_builtin/supervisor";
      const selfOk = existsSync(join(supDir, "self.md")) && readFileSync(join(supDir, "self.md"), "utf8").includes("总管");
      rec.ok("TC-CLASS-01", "instantiate_with_new_world：supervisor class 实例化为 objects/ object（拷贝 self.md + ooc.class）",
        res.instantiated.includes("supervisor") && !res.instantiated.includes("user") && pkgOk && selfOk,
        `instantiated=${JSON.stringify(res.instantiated)}, pkgOk=${pkgOk}, selfOk=${selfOk}`);
    }

    // TC-CLASS-02: 幂等 —— 二次实例化跳过已存在 instance，保用户改动
    {
      writeFileSync(join(supDir, "self.md"), "# 用户改过的 supervisor", "utf8");
      const res = await instantiateBuiltinClassObjects({ baseDir });
      const preserved = readFileSync(join(supDir, "self.md"), "utf8").includes("用户改过");
      rec.ok("TC-CLASS-02", "实例化幂等：二次 bootstrap 跳过、保用户改动",
        res.skipped.includes("supervisor") && preserved, `skipped=${JSON.stringify(res.skipped)}, preserved=${preserved}`);
    }

    // TC-CLASS-03: instance 经 class 链继承框架 class 的 seed knowledge
    {
      const { loadKnowledgeIndex } = await import("@ooc/core/thinkable/knowledge/loader");
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      reg.registerNewObjectType("_builtin/supervisor" as any, { methods: {} });
      reg.registerNewObjectType("supervisor" as any, { methods: {}, parentClass: "_builtin/supervisor" });
      const idx = await loadKnowledgeIndex(
        { stone: { baseDir, objectId: "supervisor" }, pool: { baseDir, objectId: "supervisor" } }, reg);
      const paths = [...idx.byPath.keys()];
      rec.ok("TC-CLASS-03", "instance 经 class 链继承框架 class 的 seed knowledge（nine-dimensions / world-vocabulary）",
        paths.some((p) => p.includes("nine-dimensions")) && paths.some((p) => p.includes("world-vocabulary")),
        `inherited=${JSON.stringify(paths)}`);
    }

    // TC-CLASS-04: class 不可交互 —— seedSession 拒绝 _builtin/ class 目标
    {
      const r = await postJson(app, "/api/sessions", {
        sessionId: "sb-class-reject", targetObjectId: "_builtin/supervisor", initialMessage: "hi",
      });
      rec.ok("TC-CLASS-04", "class 不可交互：seedSession 拒绝 _builtin/ class 作为对话目标",
        r.status === 400 && /class/i.test(JSON.stringify(r.json)), `status=${r.status}, body=${JSON.stringify(r.json)?.slice(0, 100)}`);
    }

    // ─────────────── 组合（agent 像持有 data 一样持有 tool-object 成员）───────────────

    // TC-COMP-01: filesystem 成员对象类注册（grep/glob/open_file/write_file + readable）
    {
      const def = builtinRegistry.getObjectDefinition("filesystem");
      const ok = !!(def.methods?.grep && def.methods?.glob && def.methods?.open_file && def.methods?.write_file && def.readable);
      rec.ok("TC-COMP-01", "filesystem 成员对象类注册：grep/glob/open_file/write_file + readable",
        ok, `methods=${Object.keys(def.methods ?? {}).join(",")}`);
    }

    // TC-COMP-02: agent 基类声明成员 + supervisor 经 ooc.class 继承 agent（Object/Agent split 结构）
    {
      const agentDir = resolveBuiltinReadDir({ objectId: "_builtin/agent" });
      const supDir = resolveBuiltinReadDir({ objectId: "_builtin/supervisor" });
      let members: unknown; let supClass: unknown;
      try { members = JSON.parse(readFileSync(join(agentDir!, "package.json"), "utf8"))?.ooc?.members; } catch { /* */ }
      try { supClass = JSON.parse(readFileSync(join(supDir!, "package.json"), "utf8"))?.ooc?.class; } catch { /* */ }
      const m = Array.isArray(members) ? (members as string[]) : [];
      rec.ok("TC-COMP-02", "agent 基类声明 filesystem+terminal 成员，supervisor 经 ooc.class 继承 _builtin/agent",
        m.includes("filesystem") && m.includes("terminal") && supClass === "_builtin/agent",
        `agentMembers=${JSON.stringify(members)} supClass=${JSON.stringify(supClass)}`);
    }

    // TC-COMP-03: 组合注入 —— supervisor thread 经类声明注入两个 member 窗（非持久化）
    {
      const thread: any = { id: "root", status: "running",
        persistence: { baseDir, sessionId: "sb-comp", objectId: "supervisor", threadId: "root" }, contextWindows: [] };
      await injectMemberWindowsIfObjectThread(thread);
      const fsWin = thread.contextWindows.find((w: any) => w.class === "filesystem");
      const tmWin = thread.contextWindows.find((w: any) => w.class === "terminal");
      rec.ok("TC-COMP-03", "组合注入：supervisor thread 经类声明注入 filesystem + terminal member 窗（isMemberWindow 非持久化）",
        !!fsWin && fsWin.isMemberWindow === true && !!tmWin && tmWin.isMemberWindow === true,
        `members=${thread.contextWindows.filter((w: any) => w.isMemberWindow).map((w: any) => w.class).join(",")}`);
    }

    // TC-COMP-04（机制命门）: exec(filesystem, grep) 经成员方法造出 search 对象
    {
      const thread: any = { id: "root", status: "running",
        persistence: { baseDir, sessionId: "sb-comp", objectId: "supervisor", threadId: "root" },
        contextWindows: [{ id: "filesystem", class: "filesystem", parentWindowId: "root",
          title: "member: filesystem", status: "open", createdAt: Date.now(), isMemberWindow: true }] };
      const mgr = WindowManager.fromThread(thread, builtinRegistry);
      await mgr.openMethodExec({ thread, parentWindowId: "filesystem", method: "grep", title: "grep",
        args: { pattern: "version", path: baseDir } });
      const search = mgr.list().find((w) => w.class === "search") as any;
      const routed = !!search && search.kind === "grep" && (search.matches?.length ?? 0) > 0;
      rec.ok("TC-COMP-04", "组合机制命门：exec(filesystem, grep) 经成员方法真跑出 grep 命中（search.kind=grep, matches>0）",
        routed, `search=${search ? `kind=${search.kind} matches=${search.matches?.length}` : "none"}`);
    }

    // TC-COMP-05: Object/Agent 边界 —— tool-object 成员**不是 Agent**（有自己工具方法，无 agency）
    {
      const fsGrep = !!builtinRegistry.resolveMethod("filesystem", "grep");
      const tmProg = !!builtinRegistry.resolveMethod("terminal", "program");
      const fsNoTalk = !builtinRegistry.resolveMethod("filesystem", "talk");
      const tmNoDo = !builtinRegistry.resolveMethod("terminal", "do");
      const agentHasTalk = !!builtinRegistry.resolveMethod("_builtin/agent", "talk"); // agency 在 agent 基类
      rec.ok("TC-COMP-05", "Object/Agent 边界：filesystem/terminal 有自己工具方法但无 agency(talk/do)，agency 属 _builtin/agent",
        fsGrep && tmProg && fsNoTalk && tmNoDo && agentHasTalk,
        `fsGrep=${fsGrep} tmProg=${tmProg} fsNoTalk=${fsNoTalk} tmNoDo=${tmNoDo} agentTalk=${agentHasTalk}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "class", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor, calledMethodOk, calledMethodOnWindowOk } from "../_harness/agent-native";

/**
 * Tier B —— agent-native：
 * 1) 身份复现：supervisor（class 实例）加载了 self.md 设计身份（非即兴演）。
 * 2) 组合：agent 在真实 thinkloop 里**发现并调用 filesystem 成员对象**的 grep 方法
 *    （window_id="filesystem"），证明组合机制 agent-native 可用。
 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;

  const identity = await demoViaSupervisor("class", `sb-an-class-${tag}`,
    "你好 supervisor，请用一两句话说明你是谁、你的核心职责是什么。",
    async ({ lastSay }) => {
      const ok = /中枢|总管|入口|接待|分发|守护/.test(lastSay);
      return { ok, detail: `身份复现：${lastSay.slice(0, 90)}` };
    });

  const composition = await demoViaSupervisor("class", `sb-an-comp-${tag}`,
    "你的 context 里有一个 filesystem 成员对象（一个 tool-object）。请用它的 grep 方法搜索包含 'OOC' 的内容，然后用一句话告诉我你用了哪个对象、命中了什么。",
    async ({ sid, threadId, lastSay }) => {
      const onFilesystem = await calledMethodOnWindowOk(sid, "supervisor", threadId, "filesystem", "grep");
      const grepOk = onFilesystem || (await calledMethodOk(sid, "supervisor", threadId, "grep"));
      const ok = onFilesystem; // 严格判据：必须在 filesystem 成员窗上调 grep
      return { ok, detail: `onFilesystem=${onFilesystem} grepOk=${grepOk} say=${lastSay.slice(0, 80)}` };
    });

  const tcs: TcResult[] = [
    { ...(identity.tcs[0] ?? { id: "", name: "class", status: "FAIL" as const }), id: "AN-CLASS-01" },
    { ...(composition.tcs[0] ?? { id: "", name: "class", status: "FAIL" as const }), id: "AN-COMP-01",
      name: "组合：agent 调用 filesystem 成员对象的 grep" },
  ];
  return {
    capability: "class", tier: "agent-native", tcs, storyTier: rollupTier(tcs),
    trace: [...(identity.trace ?? []), "── 组合 ──", ...(composition.trace ?? [])],
  };
}
