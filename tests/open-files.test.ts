/**
 * Open-files 中枢单测（Phase 3）
 *
 * 把 trait "激活" 折叠为 "文件 open"：
 * getOpenFiles(thread, stone) 返回三类文件路径集合：
 * - pinned: 对象 origin 阶段 open 的（readme.activated_traits + data._traits_ref 解析 + 线程显式 pin 的）
 * - transient: process 阶段 open 的（command_binding / open(command) / partial submit 触发的）
 * - inject: target 阶段的 <relations> 索引等渲染片段（Phase 5/6 填充；此处测试空数组）
 *
 * 行为等价：Phase 3 的 getOpenFiles 必须与原有 getActiveTraits + pinnedTraits
 * 产生相同的 trait 集合（不多不少，deps 递归一致）。
 */

import { describe, test, expect } from "bun:test";
import { getOpenFiles } from "../src/thread/open-files.js";
import type { TraitDefinition, StoneData } from "../src/types/index.js";
import type { ThreadsTreeFile, ThreadDataFile } from "../src/thread/types.js";

/** 构造一个最小化 TraitDefinition（避免每个测试重复 boilerplate） */
function trait(
  namespace: "kernel" | "library" | "self",
  name: string,
  opts?: {
    when?: "always" | "never" | string;
    deps?: string[];
    readme?: string;
    command_binding?: string[];
  },
): TraitDefinition {
  return {
    namespace,
    name,
    kind: "trait",
    type: "how_to_think",
    version: "1.0.0",
    when: (opts?.when as TraitDefinition["when"]) ?? "never",
    description: "",
    readme: opts?.readme ?? `# ${namespace}:${name}`,
    methods: [],
    deps: opts?.deps ?? [],
    commandBinding: opts?.command_binding
      ? { commands: opts.command_binding }
      : undefined,
    dir: `/fake/${namespace}/${name}`,
  };
}

/** 构造最小 stone */
function stone(data?: Record<string, unknown>): StoneData {
  return {
    name: "alice",
    dir: "/fake/stones/alice",
    thinkable: { whoAmI: "I am alice" },
    data: data ?? {},
  } as StoneData;
}

/** 构造最小线程树（root + 单节点） */
function singleNodeTree(
  opts?: {
    traits?: string[];
    activatedTraits?: string[];
    pinnedTraits?: string[];
  },
): { tree: ThreadsTreeFile; threadData: ThreadDataFile; threadId: string } {
  const threadId = "r";
  const tree: ThreadsTreeFile = {
    rootId: threadId,
    nodes: {
      [threadId]: {
        id: threadId,
        title: "root",
        status: "running",
        childrenIds: [],
        traits: opts?.traits,
        activatedTraits: opts?.activatedTraits,
        pinnedTraits: opts?.pinnedTraits,
        createdAt: 0,
        updatedAt: 0,
      },
    },
  };
  const threadData: ThreadDataFile = {
    id: threadId,
    actions: [],
  };
  return { tree, threadData, threadId };
}

describe("getOpenFiles — origin 阶段（stone readme + _traits_ref）", () => {
  test("always trait 被 open 进 pinned（origin 层）", () => {
    const traits = [trait("kernel", "computable", { when: "always" })];
    const s = stone();
    const { tree, threadData, threadId } = singleNodeTree();

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const ids = result.pinned.map((w) => w.name);
    expect(ids).toContain("kernel:computable");
  });

  test("_traits_ref 列出的 trait 被 open 进 pinned（origin 层）", () => {
    const traits = [
      trait("library", "git_ops"),
      trait("kernel", "talkable"),
    ];
    const s = stone({ _traits_ref: ["library:git_ops", "kernel:talkable"] });
    const { tree, threadData, threadId } = singleNodeTree();

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const ids = result.pinned.map((w) => w.name);
    expect(ids).toContain("library:git_ops");
    expect(ids).toContain("kernel:talkable");
  });

  test("when=never 且不在 _traits_ref 中 → 不在 pinned", () => {
    const traits = [
      trait("library", "secret_trait"),
      trait("library", "git_ops"),
    ];
    const s = stone({ _traits_ref: ["library:git_ops"] });
    const { tree, threadData, threadId } = singleNodeTree();

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const ids = result.pinned.map((w) => w.name);
    expect(ids).toContain("library:git_ops");
    expect(ids).not.toContain("library:secret_trait");
  });
});

describe("getOpenFiles — process 阶段（线程级 activatedTraits）", () => {
  test("线程显式 activatedTraits → transient", () => {
    const traits = [
      trait("kernel", "plannable"),
    ];
    const s = stone();
    const { tree, threadData, threadId } = singleNodeTree({
      activatedTraits: ["kernel:plannable"],
    });

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const transientIds = result.transient.map((w) => w.name);
    expect(transientIds).toContain("kernel:plannable");
  });

  test("pinnedTraits 的 lifespan=pinned，非 pinned 的是 transient", () => {
    const traits = [
      trait("library", "git_ops"),
      trait("kernel", "plannable"),
    ];
    const s = stone();
    const { tree, threadData, threadId } = singleNodeTree({
      activatedTraits: ["library:git_ops", "kernel:plannable"],
      pinnedTraits: ["library:git_ops"],
    });

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    /* git_ops: 在 pinnedTraits 中 → pinned 集合 */
    expect(result.pinned.map((w) => w.name)).toContain("library:git_ops");
    /* plannable: 只在 activatedTraits 不在 pinnedTraits → transient */
    expect(result.transient.map((w) => w.name)).toContain("kernel:plannable");
    expect(result.pinned.map((w) => w.name)).not.toContain("kernel:plannable");
  });

  test("deps 递归激活（A deps B，A 在 scope 则 B 也应 open）", () => {
    const traits = [
      trait("library", "doc_api", { when: "always", deps: ["library:base_io"] }),
      trait("library", "base_io"),
    ];
    const s = stone();
    const { tree, threadData, threadId } = singleNodeTree();

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const ids = [
      ...result.pinned.map((w) => w.name),
      ...result.transient.map((w) => w.name),
    ];
    expect(ids).toContain("library:doc_api");
    expect(ids).toContain("library:base_io");
  });
});

describe("getOpenFiles — instructions 区分（kernel → instructions，其他 → knowledge）", () => {
  test("kernel trait → instructions；library/self → knowledge", () => {
    const traits = [
      trait("kernel", "computable", { when: "always" }),
      trait("library", "git_ops"),
      trait("self", "reporter"),
    ];
    const s = stone({ _traits_ref: ["library:git_ops", "self:reporter"] });
    const { tree, threadData, threadId } = singleNodeTree();

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    expect(result.instructions.map((w) => w.name)).toContain("kernel:computable");
    expect(result.knowledge.map((w) => w.name)).toContain("library:git_ops");
    expect(result.knowledge.map((w) => w.name)).toContain("self:reporter");
    /* kernel 不应出现在 knowledge，library/self 不应出现在 instructions */
    expect(result.knowledge.map((w) => w.name)).not.toContain("kernel:computable");
    expect(result.instructions.map((w) => w.name)).not.toContain("library:git_ops");
  });
});

describe("getOpenFiles — inject 阶段（Phase 5/6 扩展点）", () => {
  test("Phase 3 默认 inject 为空数组（target 阶段未填充）", () => {
    const traits = [trait("kernel", "computable", { when: "always" })];
    const s = stone();
    const { tree, threadData, threadId } = singleNodeTree();

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    expect(result.inject).toEqual([]);
  });
});

describe("getOpenFiles — activeTraitIds 便利属性", () => {
  test("返回所有 open 中 trait 的完整 ID 列表（origin + process 去重）", () => {
    const traits = [
      trait("kernel", "computable", { when: "always" }),
      trait("library", "git_ops"),
    ];
    const s = stone({ _traits_ref: ["library:git_ops"] });
    const { tree, threadData, threadId } = singleNodeTree({
      activatedTraits: ["library:git_ops"] /* 重复声明：应去重 */,
    });

    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const ids = new Set(result.activeTraitIds);
    expect(ids.has("kernel:computable")).toBe(true);
    expect(ids.has("library:git_ops")).toBe(true);
    /* 去重 */
    expect(result.activeTraitIds.length).toBe(new Set(result.activeTraitIds).size);
  });
});

/**
 * Phase 3 — llm_input_viewer：source 来源溯源
 *
 * 每个 ContextWindow 带一个 source 枚举，用于前端 hover 显示"为什么激活"。
 * 优先级：always_on > thread_pinned > stone_default > command_binding > scope_chain
 */
describe("getOpenFiles — source 来源溯源（Phase 3）", () => {
  function findByName(windows: Array<{ name: string; source?: string }>, name: string) {
    return windows.find((w) => w.name === name);
  }

  test("when=always trait → source=always_on", () => {
    const traits = [trait("kernel", "computable", { when: "always" })];
    const s = stone();
    const { tree, threadData, threadId } = singleNodeTree();
    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const w = findByName(result.pinned, "kernel:computable");
    expect(w?.source).toBe("always_on");
  });

  test("线程 pinnedTraits → source=thread_pinned", () => {
    const traits = [trait("library", "git_ops")];
    const s = stone();
    const { tree, threadData, threadId } = singleNodeTree({
      activatedTraits: ["library:git_ops"],
      pinnedTraits: ["library:git_ops"],
    });
    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const w = findByName(result.pinned, "library:git_ops");
    expect(w?.source).toBe("thread_pinned");
  });

  test("stone._traits_ref → source=stone_default", () => {
    const traits = [trait("library", "git_ops")];
    const s = stone({ _traits_ref: ["library:git_ops"] });
    const { tree, threadData, threadId } = singleNodeTree();
    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const w = findByName(result.pinned, "library:git_ops");
    expect(w?.source).toBe("stone_default");
  });

  test("仅 activatedTraits（非 pinned） → source=command_binding（transient）", () => {
    const traits = [trait("kernel", "plannable")];
    const s = stone();
    const { tree, threadData, threadId } = singleNodeTree({
      activatedTraits: ["kernel:plannable"],
    });
    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const w = findByName(result.transient, "kernel:plannable");
    expect(w?.source).toBe("command_binding");
    expect(w?.lifespan).toBe("transient");
  });

  test("优先级：always_on > thread_pinned > stone_default > command_binding", () => {
    /* 同时命中 when=always + pinnedTraits + stoneRefs + activatedTraits → 取 always_on */
    const traits = [trait("kernel", "talkable", { when: "always" })];
    const s = stone({ _traits_ref: ["kernel:talkable"] });
    const { tree, threadData, threadId } = singleNodeTree({
      activatedTraits: ["kernel:talkable"],
      pinnedTraits: ["kernel:talkable"],
    });
    const result = getOpenFiles({ tree, threadId, threadData, stone: s, traits });
    const w = findByName(result.pinned, "kernel:talkable");
    expect(w?.source).toBe("always_on");
  });
});
