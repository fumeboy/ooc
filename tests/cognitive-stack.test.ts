/**
 * 认知栈模块测试 (G13)
 *
 * 覆盖 computeScopeChain, collectFrameHooks, focus_push/focus_pop 语义
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createProcess,
  addNode,
  findNode,
  moveFocus,
  resetNodeCounter,
  completeNode,
  advanceFocus,
} from "../src/process/index.js";
import { computeScopeChain, collectFrameHooks } from "../src/process/cognitive-stack.js";
import { getActiveTraits, traitId } from "../src/knowledge/activator.js";
import type { TraitDefinition } from "../src/types/index.js";

beforeEach(() => {
  resetNodeCounter();
});

/** 创建测试用的 TraitDefinition (namespace:name 格式，namespace 限定为 kernel|library|self) */
const makeTrait = (
  namespace: TraitDefinition["namespace"],
  name: string,
  opts?: {
    when?: string;
    hooks?: TraitDefinition["hooks"];
  },
): TraitDefinition => ({
  namespace,
  name,
  kind: "trait",
  type: "how_to_think",
  when: opts?.when ?? "always",
  description: "",
  readme: "",
  methods: [],
  deps: [],
  hooks: opts?.hooks,
});

/* ========== computeScopeChain ========== */

describe("computeScopeChain", () => {
  test("空 traits 返回空数组", () => {
    const p = createProcess("任务");
    expect(computeScopeChain(p)).toEqual([]);
  });

  test("从 focus 路径收集静态声明的 traits", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "调研", undefined, undefined, ["research/core", "web/search"])!;
    moveFocus(p, id1);

    const chain = computeScopeChain(p);
    expect(chain).toContain("research/core");
    expect(chain).toContain("web/search");
  });

  test("从 focus 路径收集 activatedTraits", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "分析")!;
    moveFocus(p, id1);

    /* 模拟 activateTrait 写入 */
    const node = findNode(p.root, id1)!;
    node.activatedTraits = ["analysis/core"];

    const chain = computeScopeChain(p);
    expect(chain).toContain("analysis/core");
  });

  test("合并路径上所有节点的 traits（去重）", () => {
    const p = createProcess("任务");
    p.root.traits = ["base/core"];
    const id1 = addNode(p, p.root.id, "步骤1", undefined, undefined, ["base/core", "research/core"])!;
    moveFocus(p, id1);

    const chain = computeScopeChain(p);
    /* base 出现在根和子节点，应去重 */
    expect(chain.filter(t => t === "base/core")).toHaveLength(1);
    expect(chain).toContain("research/core");
  });

  test("focus 不在路径上的节点 traits 不包含", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "分支A", undefined, undefined, ["trait/a"])!;
    addNode(p, p.root.id, "分支B", undefined, undefined, ["trait/b"]);
    moveFocus(p, id1);

    const chain = computeScopeChain(p);
    expect(chain).toContain("trait/a");
    expect(chain).not.toContain("trait/b");
  });

  test("深层嵌套路径收集所有祖先 traits", () => {
    const p = createProcess("任务");
    p.root.traits = ["root/trait"];
    const id1 = addNode(p, p.root.id, "L1", undefined, undefined, ["l1/trait"])!;
    const id2 = addNode(p, id1, "L2", undefined, undefined, ["l2/trait"])!;
    moveFocus(p, id2);

    const chain = computeScopeChain(p);
    expect(chain).toContain("root/trait");
    expect(chain).toContain("l1/trait");
    expect(chain).toContain("l2/trait");
  });
});

/* ========== collectFrameHooks ========== */

describe("collectFrameHooks", () => {
  test("收集 before hooks", () => {
    const traits: TraitDefinition[] = [
      {
        namespace: "library",
        name: "reflective",
        kind: "trait",
        type: "how_to_think",
        when: "always",
        description: "",
        readme: "",
        methods: [],
        deps: [],
        hooks: { before: { inject: "准备工作", once: false } },
      },
    ];
    const fired = new Set<string>();
    const result = collectFrameHooks("before", traits, [], fired);
    expect(result).not.toBeNull();
    expect(result!).toContain("准备工作");
    expect(fired.has("library:reflective:before")).toBe(true);
  });

  test("收集 after hooks", () => {
    const traits: TraitDefinition[] = [
      {
        namespace: "library",
        name: "reflective",
        kind: "trait",
        type: "how_to_think",
        when: "always",
        description: "",
        readme: "",
        methods: [],
        deps: [],
        hooks: { after: { inject: "回顾总结", once: false } },
      },
    ];
    const fired = new Set<string>();
    const result = collectFrameHooks("after", traits, [], fired);
    expect(result).not.toBeNull();
    expect(result!).toContain("回顾总结");
  });

  test("once hook 只触发一次", () => {
    const traits: TraitDefinition[] = [
      {
        namespace: "library",
        name: "reflective",
        kind: "trait",
        type: "how_to_think",
        when: "always",
        description: "",
        readme: "",
        methods: [],
        deps: [],
        hooks: { before: { inject: "只触发一次", once: true } },
      },
    ];
    const fired = new Set<string>();

    const r1 = collectFrameHooks("before", traits, [], fired);
    expect(r1).not.toBeNull();
    expect(r1!).toContain("只触发一次");

    const r2 = collectFrameHooks("before", traits, [], fired);
    expect(r2).toBeNull();
  });

  test("once: false 的 hook 可重复触发", () => {
    const traits: TraitDefinition[] = [
      {
        namespace: "library",
        name: "reflective",
        kind: "trait",
        type: "how_to_think",
        when: "always",
        description: "",
        readme: "",
        methods: [],
        deps: [],
        hooks: { after: { inject: "每次都触发", once: false } },
      },
    ];
    const fired = new Set<string>();

    const r1 = collectFrameHooks("after", traits, [], fired);
    expect(r1).not.toBeNull();
    expect(r1!).toContain("每次都触发");

    const r2 = collectFrameHooks("after", traits, [], fired);
    expect(r2).not.toBeNull();
    expect(r2!).toContain("每次都触发");
  });

  test("只收集作用域链中或 always 的 traits", () => {
    const traits: TraitDefinition[] = [
      {
        namespace: "kernel",
        name: "always_trait",
        kind: "trait",
        type: "how_to_think",
        when: "always",
        description: "",
        readme: "",
        methods: [],
        deps: [],
        hooks: { before: { inject: "always", once: false } },
      },
      {
        namespace: "library",
        name: "conditional",
        kind: "trait",
        type: "how_to_think",
        when: "当需要时",
        description: "",
        readme: "",
        methods: [],
        deps: [],
        hooks: { before: { inject: "conditional", once: false } },
      },
    ];
    const fired = new Set<string>();

    /* conditional 不在 scopeChain 中，不应触发 */
    const r1 = collectFrameHooks("before", traits, [], fired);
    expect(r1).toContain("always");
    expect(r1).not.toContain("conditional");

    /* conditional 在 scopeChain 中，应触发 */
    const fired2 = new Set<string>();
    const r2 = collectFrameHooks("before", traits, ["library:conditional"], fired2);
    expect(r2).toContain("always");
    expect(r2).toContain("conditional");
  });

  test("无 hook 时返回 null", () => {
    const traits: TraitDefinition[] = [
      { namespace: "library", name: "empty", kind: "trait", type: "how_to_think", when: "always", description: "", readme: "", methods: [], deps: [] },
    ];
    const fired = new Set<string>();
    expect(collectFrameHooks("before", traits, [], fired)).toBeNull();
  });

  test("once hook 在不同 focusNodeId 下各触发一次", () => {
    const traits: TraitDefinition[] = [
      {
        namespace: "kernel",
        name: "plannable",
        kind: "trait",
        type: "how_to_think",
        when: "always",
        description: "",
        readme: "",
        methods: [],
        deps: [],
        hooks: { before: { inject: "评估任务", once: true } },
      },
    ];
    const fired = new Set<string>();

    // 第一个节点触发
    const r1 = collectFrameHooks("before", traits, [], fired, "node-1");
    expect(r1).not.toBeNull();
    expect(r1!).toContain("评估任务");

    // 同一节点不再触发
    const r2 = collectFrameHooks("before", traits, [], fired, "node-1");
    expect(r2).toBeNull();

    // 不同节点再次触发
    const r3 = collectFrameHooks("before", traits, [], fired, "node-2");
    expect(r3).not.toBeNull();
    expect(r3!).toContain("评估任务");
  });
});

/* ========== focus_push / focus_pop 语义集成测试 ========== */

describe("focus_push / focus_pop 语义", () => {
  test("focus_push: 在当前 focus 下创建子帧并进入", () => {
    const p = createProcess("任务");
    /* 模拟 focus_push */
    const id = addNode(p, p.focusId, "调研", undefined, "搜索论文", ["web/search"])!;
    moveFocus(p, id);

    expect(p.focusId).toBe(id);
    const node = findNode(p.root, id)!;
    expect(node.status).toBe("doing");
    expect(node.traits).toEqual(["web/search"]);
    expect(node.description).toBe("搜索论文");
  });

  test("focus_pop: 完成当前帧并自动推进", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "步骤1")!;
    const id2 = addNode(p, p.root.id, "步骤2")!;
    moveFocus(p, id1);

    /* 模拟 focus_pop */
    completeNode(p, id1, "步骤1完成");
    advanceFocus(p);

    expect(findNode(p.root, id1)!.status).toBe("done");
    expect(findNode(p.root, id1)!.summary).toBe("步骤1完成");
    expect(p.focusId).toBe(id2);
  });

  test("focus_push 带 traits → computeScopeChain 包含 → focus_pop 后不包含", () => {
    const p = createProcess("任务");

    /* push 带 traits */
    const id1 = addNode(p, p.focusId, "调研", undefined, undefined, ["research/core"])!;
    const id2 = addNode(p, p.focusId, "撰写")!;
    moveFocus(p, id1);

    let chain = computeScopeChain(p);
    expect(chain).toContain("research/core");

    /* pop: 完成调研，focus 推进到撰写 */
    completeNode(p, id1, "完成");
    moveFocus(p, id2);

    chain = computeScopeChain(p);
    expect(chain).not.toContain("research/core");
  });

  test("activatedTraits 绑定在栈帧上，focus 离开后失效", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "步骤1")!;
    const id2 = addNode(p, p.root.id, "步骤2")!;
    moveFocus(p, id1);

    /* 模拟 activateTrait */
    findNode(p.root, id1)!.activatedTraits = ["dynamic/trait"];
    let chain = computeScopeChain(p);
    expect(chain).toContain("dynamic/trait");

    /* 完成步骤1，移到步骤2 */
    completeNode(p, id1, "done");
    moveFocus(p, id2);

    chain = computeScopeChain(p);
    expect(chain).not.toContain("dynamic/trait");
  });
});

/* ========== computable trait 激活 ========== */

describe("computable trait 激活", () => {
  test("computable (when: always) 始终被激活", () => {
    const traits: TraitDefinition[] = [
      {
        namespace: "kernel",
        name: "computable",
        kind: "trait",
        type: "how_to_think",
        when: "always",
        description: "认知栈思维模式",
        readme: "...",
        methods: [],
        deps: [],
      },
      {
        namespace: "kernel",
        name: "plannable",
        kind: "trait",
        type: "how_to_think",
        when: "当任务包含多个步骤时",
        description: "规划能力",
        readme: "...",
        methods: [],
        deps: [],
        hooks: { before: { inject: "评估任务", once: true } },
      },
    ];

    // 空 scopeChain — computable 仍然激活
    const active = getActiveTraits(traits, []);
    const ids = active.map(t => traitId(t));
    expect(ids).toContain("kernel:computable");
    expect(ids).not.toContain("kernel:plannable");
  });

  test("plannable 在 scopeChain 中时被激活，before hook 可触发", () => {
    const traits: TraitDefinition[] = [
      {
        namespace: "kernel",
        name: "computable",
        kind: "trait",
        type: "how_to_think",
        when: "always",
        description: "认知栈思维模式",
        readme: "...",
        methods: [],
        deps: [],
      },
      {
        namespace: "kernel",
        name: "plannable",
        kind: "trait",
        type: "how_to_think",
        when: "当任务包含多个步骤时",
        description: "规划能力",
        readme: "...",
        methods: [],
        deps: [],
        hooks: { before: { inject: "评估任务", once: true } },
      },
    ];

    const active = getActiveTraits(traits, ["kernel:plannable"]);
    const ids = active.map(t => traitId(t));
    expect(ids).toContain("kernel:computable");
    expect(ids).toContain("kernel:plannable");

    // before hook 可触发
    const plannable = active.find(t => traitId(t) === "kernel:plannable")!;
    expect(plannable.hooks?.before?.inject).toContain("评估任务");
  });
});

/* ========== before hook 注入集成 ========== */

describe("before hook 注入集成", () => {
  test("plannable before hook 通过 collectFrameHooks 注入到 chatMessages", () => {
    const traits: TraitDefinition[] = [
      makeTrait("kernel", "plannable", {
        when: "当任务包含多个步骤时",
        hooks: { before: { inject: "你刚进入一个新的任务节点。在开始执行之前，先评估", once: true } },
      }),
    ];

    const fired = new Set<string>();
    // 模拟 plannable 在 scopeChain 中
    const result = collectFrameHooks("before", traits, ["kernel:plannable"], fired, "node-1");

    // 验证注入文本包含评估提示
    expect(result).not.toBeNull();
    expect(result).toContain("你刚进入一个新的任务节点");
    expect(result).toContain("先评估");

    // 模拟将注入文本追加到 chatMessages
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: "user", content: "请帮我调研 AI 安全" },
    ];
    if (result) {
      chatMessages.push({ role: "user", content: result });
    }

    // 验证 chatMessages 包含 before hook 注入
    expect(chatMessages).toHaveLength(2);
    expect(chatMessages[1]!.content).toContain("先评估");
  });

  test("before hook 不在 scopeChain 中时不注入", () => {
    const traits: TraitDefinition[] = [
      makeTrait("kernel", "plannable", {
        when: "当任务包含多个步骤时",
        hooks: { before: { inject: "评估任务", once: true } },
      }),
    ];

    const fired = new Set<string>();
    // plannable 不在 scopeChain 中
    const result = collectFrameHooks("before", traits, [], fired, "node-1");
    expect(result).toBeNull();
  });
});
