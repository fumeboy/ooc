/**
 * Story: class —— 一等继承抽象（2026-06-07）。
 *
 * 能力：builtin class 经 instantiate_with_new_world 幂等实例化为 objects/ object（拷贝 self.md +
 * ooc.class）；二次实例化保用户改动；instance 经 class 链继承框架 seed knowledge；class 不可交互
 * （seedSession 拒绝 _builtin/ 目标）。规格见 class 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stoneDir as realStoneDir } from "@ooc/core/persistable";
import { mkServer, postJson, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

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
  } finally {
    await srv.cleanup();
  }
  return { capability: "class", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor } from "../_harness/agent-native";

/** Tier B —— agent-native：supervisor（class 实例）加载了 self.md 设计身份（非即兴演）。 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  return demoViaSupervisor("class", `sb-an-class-${tag}`,
    "你好 supervisor，请用一两句话说明你是谁、你的核心职责是什么。",
    async ({ lastSay }) => {
      const ok = /中枢|总管|入口|接待|分发|守护/.test(lastSay);
      return { ok, detail: `身份复现：${lastSay.slice(0, 90)}` };
    });
}
