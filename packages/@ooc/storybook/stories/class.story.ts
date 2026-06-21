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
// side-effect 装载全部 builtin class 进 builtinRegistry（filesystem/terminal/agent/… 的
// executable/readable）；不 import 它 registry 为空，下面 getClass/resolveObjectMethod 全落空。
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry";
import { injectMemberWindowsIfObjectThread } from "@ooc/core/thinkable/context/init.js";
import { WindowManager } from "@ooc/core/runtime/window-manager.js";
import { mkServer, postJson, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult, type TcResult } from "../_harness/types";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  const supDir = realStoneDir({ baseDir, objectId: "supervisor" });
  try {
    const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");

    // TC-CLASS-01: bootstrap 幂等把 kind:"object" 的 builtin（supervisor 等）实例化为 objects/ object。
    // supervisor instance 经 ooc.class 继承 _builtin/agent（agent 基类），其 self.md 是身份拷贝。
    // user / feishu_app 同为 kind:"object"，亦被实例化（被动占位 / 接入点）；本 TC 只校验 supervisor。
    {
      const res = await instantiateBuiltinClassObjects({ baseDir });
      const pkgOk = existsSync(join(supDir, "package.json"))
        && JSON.parse(readFileSync(join(supDir, "package.json"), "utf8")).ooc?.class === "_builtin/agent";
      const selfOk = existsSync(join(supDir, "self.md")) && readFileSync(join(supDir, "self.md"), "utf8").includes("总管");
      rec.ok("TC-CLASS-01", "bootstrap：supervisor (kind:object) 实例化为 objects/ object（拷贝 self.md + ooc.class=_builtin/agent）",
        res.instantiated.includes("supervisor") && pkgOk && selfOk,
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

    // TC-CLASS-03: instance 经 ooc.class 单跳继承其 class 的 seed knowledge（loader Step 1b，
    // 无条件继承、不门控 inheritable）。建一个 base class（写 seed knowledge 进其 stone 目录）+
    // 一个 instance（parentClass 单跳指向它），验 instance 加载时纳入 class 的 seed。
    {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { loadKnowledgeIndex } = await import("@ooc/core/thinkable/knowledge/loader");
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const { stoneKnowledgeDir } = await import("@ooc/core/persistable");
      const reg = createObjectRegistry();
      reg.register("base_role", { executable: { methods: [] } } as never, { parentClass: null });
      reg.register("my_agent", { executable: { methods: [] } } as never, { parentClass: "base_role" });
      const classKnowledgeDir = stoneKnowledgeDir({ baseDir, objectId: "base_role" } as never);
      await mkdir(classKnowledgeDir, { recursive: true });
      await writeFile(join(classKnowledgeDir, "nine-dimensions.md"), "---\ntitle: 九维度\n---\nbody", "utf8");
      await writeFile(join(classKnowledgeDir, "world-vocabulary.md"), "---\ntitle: world vocab\n---\nbody", "utf8");
      const idx = await loadKnowledgeIndex(
        { stone: { baseDir, objectId: "my_agent" }, pool: { baseDir, objectId: "my_agent" } }, reg);
      const paths = [...idx.byPath.keys()];
      rec.ok("TC-CLASS-03", "instance 经 ooc.class 单跳继承 class 的 seed knowledge（nine-dimensions / world-vocabulary）",
        reg.resolveParentClassChain("my_agent").join() === "base_role"
          && paths.some((p) => p.includes("nine-dimensions")) && paths.some((p) => p.includes("world-vocabulary")),
        `chain=${JSON.stringify(reg.resolveParentClassChain("my_agent"))} inherited=${JSON.stringify(paths)}`);
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

    // TC-COMP-01: filesystem 成员对象类注册（grep/glob/open_file/write_file object method + readable）
    {
      const cls = builtinRegistry.getClass("filesystem");
      const names = new Set((cls?.executable?.methods ?? []).map((m) => m.name));
      const ok = names.has("grep") && names.has("glob") && names.has("open_file") && names.has("write_file")
        && !!builtinRegistry.resolveReadable("filesystem");
      rec.ok("TC-COMP-01", "filesystem 成员对象类注册：grep/glob/open_file/write_file + readable",
        ok, `methods=${[...names].join(",")} readable=${!!builtinRegistry.resolveReadable("filesystem")}`);
    }

    // TC-COMP-02: supervisor 经 ooc.class 继承 _builtin/agent（Object/Agent split：supervisor=object 实例，
    // agent=承载 agency 的基类）。agency 作用域分层：talk/plan 是 agent 基类能力（注册 _builtin/agent，
    // 经单跳继承可达）；end/todo 是 thread 作用域操作（注册 _builtin/agent/thread，非 agent 基类）。
    {
      const supDir = resolveBuiltinReadDir({ objectId: "_builtin/supervisor" });
      let supClass: unknown;
      try { supClass = JSON.parse(readFileSync(join(supDir!, "package.json"), "utf8"))?.ooc?.class; } catch { /* */ }
      const agentAgency = ["talk", "plan"].every(
        (m) => !!builtinRegistry.resolveObjectMethod("_builtin/agent", m),
      );
      // end/todo 已迁 thread 作用域：不在 agent 基类、在 thread class 上。
      const endTodoOnThread = ["end", "todo"].every(
        (m) => !!builtinRegistry.resolveObjectMethod("_builtin/agent/thread", m),
      );
      const endTodoNotOnAgent = ["end", "todo"].every(
        (m) => !builtinRegistry.resolveObjectMethod("_builtin/agent", m),
      );
      rec.ok("TC-COMP-02", "supervisor 继承 _builtin/agent；talk/plan 在 agent 基类，end/todo 迁 thread 作用域",
        supClass === "_builtin/agent" && agentAgency && endTodoOnThread && endTodoNotOnAgent,
        `supClass=${JSON.stringify(supClass)} agency=${agentAgency} endTodoOnThread=${endTodoOnThread} endTodoNotOnAgent=${endTodoNotOnAgent}`);
    }

    // TC-COMP-03: 组合注入 —— agent thread 默认补齐 6 个全局单例 member 窗（非持久化）。
    // 成员 class 是 `_builtin/<id>` 前缀串；isMemberWindow 标记在投影态 win 上（win.isMemberWindow）。
    {
      const thread: any = { id: "root", status: "running",
        persistence: { baseDir, sessionId: "sb-comp", objectId: "supervisor", threadId: "root" }, contextWindows: [] };
      await injectMemberWindowsIfObjectThread(thread);
      const memberClasses = new Set(
        thread.contextWindows.filter((w: any) => w.win?.isMemberWindow === true).map((w: any) => w.class),
      );
      const expected = [
        "_builtin/filesystem", "_builtin/terminal", "_builtin/interpreter",
        "_builtin/knowledge_base", "_builtin/runtime", "_builtin/agent/skill_index",
      ];
      rec.ok("TC-COMP-03", "组合注入：agent thread 默认注入 6 个全局单例 member 窗（filesystem/terminal/interpreter/knowledge_base/runtime/skill_index，win.isMemberWindow 非持久化）",
        expected.every((c) => memberClasses.has(c)),
        `members=${[...memberClasses].join(",")}`);
    }

    // TC-COMP-04（机制命门）: exec(filesystem, grep) 经成员方法造出 search 对象。
    // grep object method 经 ctx.runtime.instantiate("_builtin/filesystem/search", …) 造子对象，
    // 其 data 含 kind/matches（业务字段在 instance.data，元信息字段 id/class/title 由 runtime 管理）。
    {
      const thread: any = { id: "root", status: "running",
        persistence: { baseDir, sessionId: "sb-comp", objectId: "supervisor", threadId: "root" },
        contextWindows: [{ id: "filesystem", class: "filesystem", parentObjectId: "root",
          title: "member: filesystem", status: "open", createdAt: Date.now(), data: {},
          win: { transient: true, isMemberWindow: true } }] };
      const mgr = WindowManager.fromThread(thread, builtinRegistry);
      await mgr.execObjectMethod("filesystem", "grep", { pattern: "version", path: baseDir }, thread);
      const search = mgr.list().find((w) => w.class === "_builtin/filesystem/search") as any;
      const data = search?.data;
      const routed = !!data && data.kind === "grep" && (data.matches?.length ?? 0) > 0;
      rec.ok("TC-COMP-04", "组合机制命门：exec(filesystem, grep) 经成员方法真跑出 grep 命中（search.data.kind=grep, matches>0）",
        routed, `search=${data ? `kind=${data.kind} matches=${data.matches?.length}` : "none"}`);
    }

    // TC-COMP-05: Object/Agent 边界 —— tool-object 成员**不是 Agent**（有自己工具方法，无 agency）
    {
      const fsGrep = !!builtinRegistry.resolveObjectMethod("filesystem", "grep");
      const tmRun = !!builtinRegistry.resolveObjectMethod("terminal", "run");
      const inRun = !!builtinRegistry.resolveObjectMethod("interpreter", "run");
      const fsNoTalk = !builtinRegistry.resolveObjectMethod("filesystem", "talk");
      const tmNoTalk = !builtinRegistry.resolveObjectMethod("terminal", "talk");
      const agentHasTalk = !!builtinRegistry.resolveObjectMethod("_builtin/agent", "talk"); // agency 在 agent 基类
      rec.ok("TC-COMP-05", "Object/Agent 边界：filesystem/terminal/interpreter 有自己工具方法但无 agency(talk)，agency 属 _builtin/agent",
        fsGrep && tmRun && inRun && fsNoTalk && tmNoTalk && agentHasTalk,
        `fsGrep=${fsGrep} tmRun=${tmRun} inRun=${inRun} fsNoTalk=${fsNoTalk} tmNoTalk=${tmNoTalk} agentTalk=${agentHasTalk}`);
    }

    // TC-COMP-06: runtime / knowledge_base 成员 —— create_object / open_knowledge 迁出 root 落到工具对象上，
    //             同样不是 Agent（无 agency）。
    {
      const rtCreate = !!builtinRegistry.resolveObjectMethod("runtime", "create_object");
      const kbOpen = !!builtinRegistry.resolveObjectMethod("knowledge_base", "open_knowledge");
      const rtNoTalk = !builtinRegistry.resolveObjectMethod("runtime", "talk");
      const kbNoTalk = !builtinRegistry.resolveObjectMethod("knowledge_base", "talk");
      // root 窗（虚拟根容器投影器）自身不持任何 object method —— create_object/open_knowledge 已迁出。
      const rootNoCreate = !builtinRegistry.resolveObjectMethod("root", "create_object");
      const rootNoOpenKn = !builtinRegistry.resolveObjectMethod("root", "open_knowledge");
      rec.ok("TC-COMP-06", "runtime.create_object / knowledge_base.open_knowledge 迁出 root 落到工具对象，且无 agency",
        rtCreate && kbOpen && rtNoTalk && kbNoTalk && rootNoCreate && rootNoOpenKn,
        `rtCreate=${rtCreate} kbOpen=${kbOpen} rtNoTalk=${rtNoTalk} kbNoTalk=${kbNoTalk} rootNoCreate=${rootNoCreate} rootNoOpenKn=${rootNoOpenKn}`);
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
      // 成员窗 id 是 class-qualified `_builtin/filesystem`（非裸 `filesystem`）。
      const onFilesystem = await calledMethodOnWindowOk(sid, "supervisor", threadId, "_builtin/filesystem", "grep");
      const grepOk = onFilesystem || (await calledMethodOk(sid, "supervisor", threadId, "grep"));
      const ok = onFilesystem; // 严格判据：必须在 filesystem 成员窗上调 grep
      return { ok, detail: `onFilesystem=${onFilesystem} grepOk=${grepOk} say=${lastSay.slice(0, 80)}` };
    });

  // 知识库成员：agent 经 knowledge_base 成员窗调 open_knowledge（open_knowledge 已迁出 root）。
  const knowledge = await demoViaSupervisor("class", `sb-an-kb-${tag}`,
    "你的 context 里有一个 knowledge_base 成员对象（一个 tool-object）。请用它的 open_knowledge 方法打开你知识索引里的任意一篇文档，然后用一句话告诉我你用了哪个对象、打开了哪篇。",
    async ({ sid, threadId, lastSay }) => {
      const onKb = await calledMethodOnWindowOk(sid, "supervisor", threadId, "_builtin/knowledge_base", "open_knowledge");
      return { ok: onKb, detail: `onKnowledgeBase=${onKb} say=${lastSay.slice(0, 80)}` };
    });

  // world/runtime 成员：agent 经 runtime 成员窗调 create_object（create_object 已迁出 root，业务 session 可调）。
  const world = await demoViaSupervisor("class", `sb-an-world-${tag}`,
    "你的 context 里有一个 runtime 成员对象（一个 tool-object，承载系统机制级操作）。请用它的 create_object 方法新建一个 objectId 为 'demo_note' 的极简对象（self.md/readable.md 各写一句话即可），然后用一句话告诉我你用了哪个对象的什么方法。",
    async ({ sid, threadId, lastSay }) => {
      const onWorld = await calledMethodOnWindowOk(sid, "supervisor", threadId, "_builtin/runtime", "create_object");
      return { ok: onWorld, detail: `onWorld=${onWorld} say=${lastSay.slice(0, 80)}` };
    });

  const tcs: TcResult[] = [
    { ...(identity.tcs[0] ?? { id: "", name: "class", status: "FAIL" as const }), id: "AN-CLASS-01" },
    { ...(composition.tcs[0] ?? { id: "", name: "class", status: "FAIL" as const }), id: "AN-COMP-01",
      name: "组合：agent 调用 filesystem 成员对象的 grep" },
    { ...(knowledge.tcs[0] ?? { id: "", name: "class", status: "FAIL" as const }), id: "AN-COMP-02",
      name: "组合：agent 调用 knowledge_base 成员对象的 open_knowledge" },
    { ...(world.tcs[0] ?? { id: "", name: "class", status: "FAIL" as const }), id: "AN-COMP-03",
      name: "组合：agent 调用 world 成员对象的 create_object" },
  ];
  return {
    capability: "class", tier: "agent-native", tcs, storyTier: rollupTier(tcs),
    trace: [
      ...(identity.trace ?? []), "── 组合(fs) ──", ...(composition.trace ?? []),
      "── 组合(kb) ──", ...(knowledge.trace ?? []), "── 组合(world) ──", ...(world.trace ?? []),
    ],
  };
}
