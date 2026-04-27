/**
 * Refine 语义单测（flat command-table 版本）
 *
 * 语义：refine(form_id, args) 累积 args、重算 commandPaths（string[]）；不执行。
 * - submit(form_id) 才执行最终指令。
 * - submit 不接受 args（参数全部走 refine）。
 *
 * 测试覆盖：
 * - FormManager.applyRefine 的累积语义 / paths 变化
 * - collectCommandTraits 支持精确 path 匹配（match 显式包含父路径）
 */

import { describe, test, expect } from "bun:test";
import { FormManager } from "../src/executable/forms/form.js";
import { collectCommandTraits } from "../src/extendable/activation/hooks.js";
import type { TraitDefinition } from "../src/types/index.js";

function trait(
  namespace: "kernel" | "library" | "self",
  name: string,
  commands?: string[],
): TraitDefinition {
  return {
    namespace,
    name,
    kind: "trait",
    type: "how_to_think",
    version: "1.0.0",
    description: "",
    readme: `# ${namespace}:${name}`,
    deps: [],
    activatesOn: commands ? { showContentWhen: commands } : undefined,
    dir: `/fake/${namespace}/${name}`,
  };
}

describe("FormManager.applyRefine — 累积语义", () => {
  test("第一次 refine 后 form 仍存在，args 被累积", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "desc");
    mgr.applyRefine(fid, { target: "sophia", context: "fork" });

    const form = mgr.getForm(fid);
    expect(form).not.toBeNull();
    expect(form!.accumulatedArgs).toEqual({ target: "sophia", context: "fork" });
    /* commandPaths 包含 talk 和 talk.fork */
    expect(form!.commandPaths).toContain("talk");
    expect(form!.commandPaths).toContain("talk.fork");
  });

  test("多次 refine 累积 args（后者覆盖前者同名字段）", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "desc");
    mgr.applyRefine(fid, { target: "sophia" });
    mgr.applyRefine(fid, { context: "continue", type: "relation_update" });

    const form = mgr.getForm(fid);
    expect(form!.accumulatedArgs).toEqual({
      target: "sophia",
      context: "continue",
      type: "relation_update",
    });
    /* commandPaths 包含所有激活路径 */
    expect(form!.commandPaths).toContain("talk");
    expect(form!.commandPaths).toContain("talk.continue");
    expect(form!.commandPaths).toContain("talk.relation_update");
    expect(form!.commandPaths).toContain("talk.continue.relation_update");
  });

  test("applyRefine 对不存在的 formId 返回 null", () => {
    const mgr = new FormManager();
    expect(mgr.applyRefine("nope", {})).toBeNull();
  });

  test("refine 不影响 activeCommandPaths 的基础路径", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "desc");
    /* 尚未 refine，activeCommandPaths 应含 "talk" */
    expect(mgr.activeCommandPaths()).toContain("talk");

    mgr.applyRefine(fid, { context: "fork" });
    /* 现在 activeCommandPaths 应同时包含 "talk" 和 "talk.fork" */
    expect(mgr.activeCommandPaths()).toContain("talk");
    expect(mgr.activeCommandPaths()).toContain("talk.fork");
  });
});

describe("FormManager.submit — 消费 form", () => {
  test("submit 后 form 被移除，引用计数 -1", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "desc");
    expect(mgr.activeCommands().has("talk")).toBe(true);
    const form = mgr.submit(fid);
    expect(form).not.toBeNull();
    expect(mgr.activeCommands().has("talk")).toBe(false);
    expect(mgr.getForm(fid)).toBeNull();
  });

  test("submit 后返回的 form 含累积的 accumulatedArgs", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "desc");
    mgr.applyRefine(fid, { target: "sophia", context: "fork" });
    const form = mgr.submit(fid);
    expect(form!.accumulatedArgs).toEqual({ target: "sophia", context: "fork" });
  });
});

describe("collectCommandTraits — 精确匹配（match 显式包含父路径）", () => {
  test("activates=talk 命中 activePath=talk.fork（父路径 talk 在 match 结果中）", () => {
    /* deriveCommandPaths("talk", {context:"fork"}) → ["talk","talk.fork"]，
     * activeCommandPaths 包含 "talk"，精确命中 activates=["talk"] */
    const traits = [trait("kernel", "talkable", ["talk"])];
    const result = collectCommandTraits(traits, new Set(["talk", "talk.fork"]));
    expect(result).toContain("kernel:talkable");
  });

  test("activates=talk.fork 精确命中 talk.fork，不命中 talk.continue", () => {
    const traits = [trait("kernel", "talkable/cross_object", ["talk.fork"])];
    expect(collectCommandTraits(traits, new Set(["talk", "talk.fork"]))).toContain(
      "kernel:talkable/cross_object",
    );
    expect(collectCommandTraits(traits, new Set(["talk", "talk.continue"]))).not.toContain(
      "kernel:talkable/cross_object",
    );
  });

  test("activates=talk.continue.relation_update 精确命中", () => {
    const traits = [
      trait("kernel", "talkable/relation_update", ["talk.continue.relation_update"]),
    ];
    expect(
      collectCommandTraits(
        traits,
        new Set(["talk", "talk.continue", "talk.relation_update", "talk.continue.relation_update"]),
      ),
    ).toContain("kernel:talkable/relation_update");
  });

  test("多个 traits：talk=match, cross_object=match, relation_update=not match（active paths=[talk,talk.fork]）", () => {
    const traits = [
      trait("kernel", "talkable", ["talk"]),
      trait("kernel", "talkable/cross_object", ["talk.fork"]),
      trait("kernel", "talkable/relation_update", ["talk.continue.relation_update"]),
    ];
    /* activePaths = talk(context=fork) 的 match 结果 */
    const result = collectCommandTraits(traits, new Set(["talk", "talk.fork"]));
    expect(result).toContain("kernel:talkable");
    expect(result).toContain("kernel:talkable/cross_object");
    expect(result).not.toContain("kernel:talkable/relation_update");
  });

  test("activates=talk 在 path='talk' 时精确命中自己", () => {
    const traits = [trait("kernel", "talkable", ["talk"])];
    expect(collectCommandTraits(traits, new Set(["talk"]))).toContain(
      "kernel:talkable",
    );
  });
});
