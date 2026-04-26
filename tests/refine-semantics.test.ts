/**
 * Refine 语义单测（取代旧的 partial-submit.test.ts）
 *
 * 语义：refine(form_id, args) 累积 args、重算 commandPath；不执行。
 * - submit(form_id) 才执行最终指令。
 * - submit 不接受 args（参数全部走 refine）。
 *
 * 测试覆盖：
 * - FormManager.applyRefine 的累积语义 / path 变化
 * - collectCommandTraits 支持 path 前缀匹配（冒泡）
 */

import { describe, test, expect } from "bun:test";
import { FormManager } from "../src/thread/form.js";
import { collectCommandTraits } from "../src/thread/hooks.js";
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
    when: "never",
    description: "",
    readme: `# ${namespace}:${name}`,
    methods: [],
    deps: [],
    activatesOn: commands ? { paths: commands } : undefined,
    dir: `/fake/${namespace}/${name}`,
  };
}

describe("FormManager.applyRefine — 累积语义", () => {
  test("第一次 partial submit 后 form 仍存在，args 被累积", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "desc");
    mgr.applyRefine(fid, { target: "sophia", context: "fork" });

    const form = mgr.getForm(fid);
    expect(form).not.toBeNull();
    expect(form!.accumulatedArgs).toEqual({ target: "sophia", context: "fork" });
    expect(form!.commandPath).toBe("talk.fork");
  });

  test("多次 partial submit 累积 args（后者覆盖前者同名字段）", () => {
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
    expect(form!.commandPath).toBe("talk.continue.relation_update");
  });

  test("partialSubmit 对不存在的 formId 返回 null", () => {
    const mgr = new FormManager();
    expect(mgr.applyRefine("nope", {})).toBeNull();
  });

  test("partial submit 不影响 activeCommandPaths 的基础路径", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "desc");
    /* 尚未 partial submit，basePath = "talk" */
    expect(mgr.activeCommandPaths()).toContain("talk");

    mgr.applyRefine(fid, { context: "fork" });
    /* 现在 activeCommandPaths 应包含 "talk.fork"（当前 form 的 deepened path） */
    expect(mgr.activeCommandPaths()).toContain("talk.fork");
  });
});

describe("FormManager.submit（非 partial）— 消费 form", () => {
  test("非 partial submit 后 form 被移除，引用计数 -1", () => {
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

describe("collectCommandTraits — 冒泡匹配（前缀）", () => {
  test("activates=talk 命中 activePath=talk.fork（父命中子）", () => {
    const traits = [trait("kernel", "talkable", ["talk"])];
    const result = collectCommandTraits(traits, new Set(["talk.fork"]));
    expect(result).toContain("kernel:talkable");
  });

  test("activates=talk.fork 只命中 talk.fork，不命中 talk.continue", () => {
    const traits = [trait("kernel", "talkable/cross_object", ["talk.fork"])];
    expect(collectCommandTraits(traits, new Set(["talk.fork"]))).toContain(
      "kernel:talkable/cross_object",
    );
    expect(collectCommandTraits(traits, new Set(["talk.continue"]))).not.toContain(
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
        new Set(["talk.continue.relation_update"]),
      ),
    ).toContain("kernel:talkable/relation_update");
  });

  test("多个 activates 冒泡：talk 命中 talk.fork + talk.continue.relation_update", () => {
    const traits = [
      trait("kernel", "talkable", ["talk"]),
      trait("kernel", "talkable/cross_object", ["talk.fork"]),
      trait("kernel", "talkable/relation_update", ["talk.continue.relation_update"]),
    ];
    /* activePath = "talk.fork"：talkable 父声明命中；cross_object 精确命中；relation_update 不命中 */
    const result = collectCommandTraits(traits, new Set(["talk.fork"]));
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
