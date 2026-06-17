/**
 * L9 — Class（一等继承抽象）。
 * class 与 object 平级、不可交互、仅供继承；builtin=class、world=object 实例、ooc.class 继承。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stoneDir as realStoneDir } from "@ooc/core/persistable";
import { postJson } from "../_harness/control-plane";
import { story, check, type Story } from "../_harness/story";

export const L9_STORIES: Story[] = [
  story({
    id: "L9-INSTANTIATE",
    layer: "class",
    expectation: "instantiate 把 supervisor (kind:object) 实例化为 objects/supervisor（拷 self.md + ooc.class=_builtin/agent）",
    design: "class：kind:\"object\" 的 builtin 落为 world object 实例，ooc.class 指向其父类（supervisor→_builtin/agent）。bootstrap/instantiate-classes",
    run: async ({ baseDir }) => {
      const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
      const res = await instantiateBuiltinClassObjects({ baseDir });
      const supDir = realStoneDir({ baseDir, objectId: "supervisor" });
      const pkg = JSON.parse(readFileSync(join(supDir, "package.json"), "utf8"));
      check(res.instantiated.includes("supervisor"), `instantiated=${JSON.stringify(res.instantiated)}`);
      check(pkg.ooc?.class === "_builtin/agent", `ooc.class=${pkg.ooc?.class}`);
      check(existsSync(join(supDir, "self.md")), "self.md 未拷贝");
    },
  }),

  story({
    id: "L9-INSTANTIATE-IDEMPOTENT",
    layer: "class",
    expectation: "二次 bootstrap 跳过已存在 instance、保用户改动",
    design: "class：实例化幂等，不覆盖用户对实例的修改。instantiate-classes 幂等",
    run: async ({ baseDir }) => {
      const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
      await instantiateBuiltinClassObjects({ baseDir });
      const supSelf = join(realStoneDir({ baseDir, objectId: "supervisor" }), "self.md");
      writeFileSync(supSelf, "# 用户改过的 supervisor", "utf8");
      const res = await instantiateBuiltinClassObjects({ baseDir });
      check(res.skipped.includes("supervisor"), `skipped=${JSON.stringify(res.skipped)}`);
      check(readFileSync(supSelf, "utf8").includes("用户改过"), "用户改动被覆盖");
    },
  }),

  story({
    id: "L9-CLASS-NOT-USER",
    layer: "class",
    expectation: "user 实例化为 objects/user，但是不继承 agent 的被动 object（无 ooc.class），区别于继承 _builtin/agent 的 supervisor",
    design: "class：user 是 kind:\"object\" 被动占位 object——被实例化但无 ooc.class（不继承任何 class、非 agent）；supervisor 经 ooc.class=_builtin/agent 成 agent 实例。builtins/object/self.md + builtins.md",
    run: async ({ baseDir }) => {
      const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
      const res = await instantiateBuiltinClassObjects({ baseDir });
      // user 是 kind:"object" → 被实例化（与 supervisor/feishu_app 同）。
      check(res.instantiated.includes("user"), `user 应被实例化（kind:object）：${JSON.stringify(res.instantiated)}`);
      // 但 user 是被动 object：无 ooc.class（不继承 agent）；supervisor 继承 _builtin/agent。
      const userPkg = JSON.parse(readFileSync(join(realStoneDir({ baseDir, objectId: "user" }), "package.json"), "utf8"));
      const supPkg = JSON.parse(readFileSync(join(realStoneDir({ baseDir, objectId: "supervisor" }), "package.json"), "utf8"));
      check(userPkg.ooc?.class === undefined, `user 不应继承任何 class：ooc.class=${userPkg.ooc?.class}`);
      check(supPkg.ooc?.class === "_builtin/agent", `supervisor 应继承 _builtin/agent：ooc.class=${supPkg.ooc?.class}`);
    },
  }),

  story({
    id: "L9-CLASS-NONINTERACTIVE",
    layer: "class",
    expectation: "seedSession 拒绝 _builtin/ class 作为对话目标（400）",
    design: "class：class 不可交互，仅供继承。modules/flows/api.seed-session 目标校验",
    run: async ({ app }) => {
      const r = await postJson(app, "/api/sessions", {
        sessionId: "sb-cls-reject", targetObjectId: "_builtin/supervisor", initialMessage: "hi",
      });
      check(r.status === 400 && /class/i.test(JSON.stringify(r.json)), `status=${r.status} body=${JSON.stringify(r.json)?.slice(0, 100)}`);
    },
  }),
];
