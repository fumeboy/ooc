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
    expectation: "instantiate 把 supervisor class 实例化为 objects/supervisor（拷 self.md + ooc.class）",
    design: "class：builtin class 经 instantiate_with_new_world 落为 world object 实例。bootstrap/instantiate-classes",
    run: async ({ baseDir }) => {
      const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
      const res = await instantiateBuiltinClassObjects({ baseDir });
      const supDir = realStoneDir({ baseDir, objectId: "supervisor" });
      const pkg = JSON.parse(readFileSync(join(supDir, "package.json"), "utf8"));
      check(res.instantiated.includes("supervisor"), `instantiated=${JSON.stringify(res.instantiated)}`);
      check(pkg.ooc?.class === "_builtin/supervisor", `ooc.class=${pkg.ooc?.class}`);
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
    expectation: "user 是被动对象，不被实例化为可交互 instance",
    design: "class：user 无 executable，不作为可交互 class 实例化。instantiate 排除 user",
    run: async ({ baseDir }) => {
      const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
      const res = await instantiateBuiltinClassObjects({ baseDir });
      check(!res.instantiated.includes("user"), `user 被误实例化：${JSON.stringify(res.instantiated)}`);
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
