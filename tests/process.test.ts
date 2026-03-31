/**
 * 行为树模块测试 (Phase 3)
 *
 * 覆盖 tree.ts、focus.ts、render.ts 的核心功能
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createProcess,
  addNode,
  completeNode,
  setNodeStatus,
  appendAction,
  findNode,
  getPathToNode,
  getParentNode,
  resetNodeCounter,
  compressActions,
  createFrameHook,
} from "../src/process/tree.js";
import {
  moveFocus,
  advanceFocus,
  getFocusNode,
  isProcessComplete,
} from "../src/process/focus.js";
import { renderProcess } from "../src/process/render.js";

beforeEach(() => {
  resetNodeCounter();
});

/* ========== tree.ts 测试 ========== */

describe("createProcess", () => {
  test("创建单根节点的行为树", () => {
    const p = createProcess("部署服务");
    expect(p.root.title).toBe("部署服务");
    expect(p.root.status).toBe("doing");
    expect(p.root.children).toEqual([]);
    expect(p.focusId).toBe(p.root.id);
  });
});

describe("addNode", () => {
  test("在根节点下添加子节点", () => {
    const p = createProcess("任务");
    const childId = addNode(p, p.root.id, "步骤 1");
    expect(childId).not.toBeNull();

    const child = findNode(p.root, childId!);
    expect(child!.title).toBe("步骤 1");
    expect(child!.status).toBe("todo");
  });

  test("新节点自动注册初始 hooks", () => {
    const p = createProcess("任务");
    const childId = addNode(p, p.root.id, "步骤 1");
    const child = findNode(p.root, childId!);

    expect(child!.hooks).toBeDefined();
    expect(child!.hooks!.length).toBe(3);
    expect(child!.hooks![0]!.when).toBe("when_stack_pop");
    expect(child!.hooks![0]!.type).toBe("inject_message");
    expect(child!.hooks![0]!.handler).toBe("summary");
    expect(child!.hooks![1]!.when).toBe("when_yield");
    expect(child!.hooks![1]!.handler).toBe("summary");
    expect(child!.hooks![2]!.when).toBe("when_yield");
    expect(child!.hooks![2]!.handler).toBe("declare_running_processes");
  });

  test("添加带依赖的子节点", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2", [id1])!;

    const node2 = findNode(p.root, id2)!;
    expect(node2.deps).toEqual([id1]);
  });

  test("父节点不存在返回 null", () => {
    const p = createProcess("任务");
    const id = addNode(p, "nonexistent", "x");
    expect(id).toBeNull();
  });

  test("多层嵌套子节点", () => {
    const p = createProcess("根");
    const l1 = addNode(p, p.root.id, "层 1")!;
    const l2 = addNode(p, l1, "层 2")!;
    const l3 = addNode(p, l2, "层 3")!;
    expect(findNode(p.root, l3)!.title).toBe("层 3");
  });
});

describe("completeNode", () => {
  test("标记节点完成", () => {
    const p = createProcess("任务");
    const id = addNode(p, p.root.id, "步骤")!;
    const ok = completeNode(p, id, "完成了");
    expect(ok).toBe(true);
    expect(findNode(p.root, id)!.status).toBe("done");
    expect(findNode(p.root, id)!.summary).toBe("完成了");
  });

  test("节点不存在返回 false", () => {
    const p = createProcess("任务");
    expect(completeNode(p, "nonexistent", "x")).toBe(false);
  });
});

describe("setNodeStatus / appendAction", () => {
  test("更新节点状态", () => {
    const p = createProcess("任务");
    setNodeStatus(p, p.root.id, "done");
    expect(p.root.status).toBe("done");
  });

  test("追加 action", () => {
    const p = createProcess("任务");
    appendAction(p, p.root.id, { type: "thought", content: "想一想", timestamp: Date.now() });
    expect(p.root.actions).toHaveLength(1);
    expect(p.root.actions[0]!.content).toBe("想一想");
  });
});

describe("findNode / getPathToNode / getParentNode", () => {
  test("findNode 查找深层节点", () => {
    const p = createProcess("根");
    const l1 = addNode(p, p.root.id, "L1")!;
    const l2 = addNode(p, l1, "L2")!;
    expect(findNode(p.root, l2)!.title).toBe("L2");
  });

  test("getPathToNode 返回从根到目标的路径", () => {
    const p = createProcess("根");
    const l1 = addNode(p, p.root.id, "L1")!;
    const l2 = addNode(p, l1, "L2")!;
    const path = getPathToNode(p.root, l2);
    expect(path.map((n) => n.title)).toEqual(["根", "L1", "L2"]);
  });

  test("getPathToNode 节点不存在返回空数组", () => {
    const p = createProcess("根");
    expect(getPathToNode(p.root, "nope")).toEqual([]);
  });

  test("getParentNode 返回父节点", () => {
    const p = createProcess("根");
    const l1 = addNode(p, p.root.id, "L1")!;
    const parent = getParentNode(p.root, l1);
    expect(parent!.id).toBe(p.root.id);
  });

  test("getParentNode 根节点无父返回 null", () => {
    const p = createProcess("根");
    expect(getParentNode(p.root, p.root.id)).toBeNull();
  });
});

/* ========== focus.ts 测试 ========== */

describe("moveFocus", () => {
  test("移动 focus 到子节点", () => {
    const p = createProcess("根");
    const id = addNode(p, p.root.id, "子")!;
    const result = moveFocus(p, id);
    expect(result.success).toBe(true);
    expect(p.focusId).toBe(id);
    /* 移动到 todo 节点会自动变为 doing */
    expect(findNode(p.root, id)!.status).toBe("doing");
  });

  test("节点不存在返回 false", () => {
    const p = createProcess("根");
    const result = moveFocus(p, "nope");
    expect(result.success).toBe(false);
  });

  test("离开 doing 节点返回 yieldedNodeId", () => {
    const p = createProcess("任务");
    const childId = addNode(p, p.root.id, "子任务")!;
    const result = moveFocus(p, childId);
    expect(result.success).toBe(true);
    expect(result.yieldedNodeId).toBe(p.root.id);
  });

  test("移到同一节点不触发 yield", () => {
    const p = createProcess("任务");
    const result = moveFocus(p, p.root.id);
    expect(result.success).toBe(true);
    expect(result.yieldedNodeId).toBeUndefined();
  });
});

describe("advanceFocus", () => {
  test("进入第一个未完成的子节点", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    addNode(p, p.root.id, "步骤 2");

    const result = advanceFocus(p);
    expect(result.focusId).toBe(id1);
    expect(p.focusId).toBe(id1);
    expect(findNode(p.root, id1)!.status).toBe("doing");
  });

  test("跳过已完成的子节点", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;
    completeNode(p, id1, "done");

    const result = advanceFocus(p);
    expect(result.focusId).toBe(id2);
  });

  test("依赖未满足时跳过节点", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2", [id1])!;

    /* focus 在根节点，步骤 2 依赖步骤 1，应先进入步骤 1 */
    const result = advanceFocus(p);
    expect(result.focusId).toBe(id1);

    /* 完成步骤 1 后应可进入步骤 2 */
    completeNode(p, id1, "done");
    moveFocus(p, p.root.id);
    const result2 = advanceFocus(p);
    expect(result2.focusId).toBe(id2);
  });

  test("子节点全部完成后自动完成父节点", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    completeNode(p, id1, "done");

    moveFocus(p, id1);
    const result = advanceFocus(p);
    /* 根节点应被自动标记为 done */
    expect(result.focusId).toBeNull();
    expect(p.root.status).toBe("done");
    expect(p.root.summary).toBeDefined();
  });

  test("多层级子节点全部完成后级联自动完成", () => {
    const p = createProcess("根");
    const idA = addNode(p, p.root.id, "分支 A")!;
    const idA1 = addNode(p, idA, "A-1")!;
    const idA2 = addNode(p, idA, "A-2")!;

    /* focus 进入 A-1 */
    moveFocus(p, idA1);
    completeNode(p, idA1, "A-1 完成");

    /* focus 进入 A-2 */
    moveFocus(p, idA2);
    completeNode(p, idA2, "A-2 完成");

    /* advanceFocus 应级联完成：分支 A → 根 */
    const result = advanceFocus(p);
    expect(result.focusId).toBeNull();
    expect(findNode(p.root, idA)!.status).toBe("done");
    expect(p.root.status).toBe("done");
  });

  test("离开 doing 节点返回 yieldedNodeId", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    addNode(p, p.root.id, "步骤 2");

    const result = advanceFocus(p);
    expect(result.focusId).toBe(id1);
    expect(result.yieldedNodeId).toBe(p.root.id);
  });
});

describe("getFocusNode", () => {
  test("返回当前 focus 节点", () => {
    const p = createProcess("根");
    const node = getFocusNode(p);
    expect(node!.title).toBe("根");
  });
});

describe("isProcessComplete", () => {
  test("叶子节点 done → 完成", () => {
    const p = createProcess("根");
    completeNode(p, p.root.id, "done");
    expect(isProcessComplete(p)).toBe(true);
  });

  test("有子节点时需全部完成", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    addNode(p, p.root.id, "步骤 2");

    expect(isProcessComplete(p)).toBe(false);

    completeNode(p, id1, "done");
    expect(isProcessComplete(p)).toBe(false);
  });

  test("所有子节点完成 → true", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;
    completeNode(p, id1, "done");
    completeNode(p, id2, "done");
    expect(isProcessComplete(p)).toBe(true);
  });
});

/* ========== render.ts 测试 ========== */

describe("renderProcess (新设计：一维时间线)", () => {
  test("渲染包含【认知栈】【聚焦路径】【当前状态】三个区域", () => {
    const p = createProcess("测试任务");
    const text = renderProcess(p);

    expect(text).toContain("【认知栈】");
    expect(text).toContain("【聚焦路径】");
    expect(text).toContain("【当前状态】");
  });

  test("按时间顺序排列 events", () => {
    const p = createProcess("测试任务");

    // 添加 thought action
    appendAction(p, p.root.id, {
      type: "thought",
      content: "开始思考",
      timestamp: 1000,
    });

    // 添加 program action
    appendAction(p, p.root.id, {
      type: "program",
      content: 'print("hello")',
      timestamp: 2000,
      success: true,
      result: "hello",
    });

    const text = renderProcess(p);

    // 验证关键元素存在
    expect(text).toContain("[thought]");
    expect(text).toContain("[program]");
    expect(text).toContain("✓ 成功");
    expect(text).toContain("开始思考");
    expect(text).toContain('print("hello")');
  });

  test("展示 [push] 和 [sub_stack_frame]", () => {
    const p = createProcess("根任务");
    const childId = addNode(p, p.root.id, "子任务")!;

    // 父节点 action
    appendAction(p, p.root.id, {
      type: "thought",
      content: "父节点思考",
      timestamp: 1000,
    });

    // 进入子节点
    moveFocus(p, childId);

    // 子节点 actions
    appendAction(p, childId, {
      type: "thought",
      content: "子节点思考",
      timestamp: 2000,
    });

    // 完成子节点
    completeNode(p, childId, "子任务完成");
    const child = findNode(p.root, childId)!;
    child.locals = { result: "some data" };

    // 回到父节点
    moveFocus(p, p.root.id);

    const text = renderProcess(p);

    expect(text).toContain("[push]");
    expect(text).toContain("[sub_stack_frame]");
    expect(text).toContain("✓ done");
    expect(text).toContain("输出 summary:");
    expect(text).toContain("输出 artifacts:");
  });

  test("【当前状态】只展示变量名，不展示值", () => {
    const p = createProcess("测试任务");
    p.root.locals = { secret: "should not show value" };
    p.root.outputs = ["result"];
    p.root.outputDescription = "测试输出";

    const text = renderProcess(p);

    // 应该展示 key，但不展示值
    expect(text).toContain("可访问变量名:");
    expect(text).toContain("secret");
    expect(text).not.toContain("should not show value");

    // 输出契约
    expect(text).toContain("输出契约:");
    expect(text).toContain("outputs: result");
    expect(text).toContain("输出描述: 测试输出");
  });

  test("时间戳格式化 HH:MM:SS", () => {
    // 导入内部函数进行测试
    const { formatTimestamp } = require("../src/process/render.js");

    // 构造一个特定时间的时间戳 (13:45:30)
    const date = new Date();
    date.setHours(13, 45, 30, 0);
    const ts = date.getTime();

    const formatted = formatTimestamp(ts);
    expect(formatted).toBe("13:45:30");
  });

  test("展示激活的 traits", () => {
    const p = createProcess("测试任务");
    p.root.traits = ["lark-wiki"];
    p.root.activatedTraits = ["git-ops"];

    const text = renderProcess(p);
    expect(text).toContain("激活 traits:");
    expect(text).toContain("lark-wiki");
    expect(text).toContain("git-ops");
  });

  test("program 失败时显示 ❌ 失败", () => {
    const p = createProcess("测试任务");
    appendAction(p, p.root.id, {
      type: "program",
      content: "errorCode()",
      timestamp: Date.now(),
      success: false,
      result: "Error: something went wrong",
    });

    const text = renderProcess(p);
    expect(text).toContain("❌ 失败");
    expect(text).toContain("Error: something went wrong");
  });

  test("focus 在深层节点时展示 push 事件", () => {
    const p = createProcess("根");
    const idA = addNode(p, p.root.id, "分支 A")!;
    const idA1 = addNode(p, idA, "A-1")!;

    moveFocus(p, idA1);
    const text = renderProcess(p);

    // 路径上的节点应该有 push 事件
    expect(text).toContain("[push] 分支 A");
    expect(text).toContain("[push] A-1");
  });

  test("结构化遗忘：不在聚焦路径上的节点完全不展示", () => {
    const p = createProcess("根");
    const idA = addNode(p, p.root.id, "分支 A")!;
    const idB = addNode(p, p.root.id, "分支 B")!;
    addNode(p, idB, "B-1");

    // focus 在分支 A
    moveFocus(p, idA);

    const text = renderProcess(p);

    // 分支 A 应该显示
    expect(text).toContain("分支 A");

    // 分支 B 不在聚焦路径上，不应该显示
    expect(text).not.toContain("分支 B");
    expect(text).not.toContain("B-1");
  });
});

/* ========== FrameHook 类型测试 ========== */

import type { FrameHook, ThreadState, Signal } from "../src/types/process.js";

describe("FrameHook types", () => {
  test("FrameHook 结构正确", () => {
    const hook: FrameHook = {
      id: "hook_1",
      when: "when_stack_pop",
      type: "inject_message",
      handler: "请确认所有子任务已完成",
    };
    expect(hook.when).toBe("when_stack_pop");
    expect(hook.type).toBe("inject_message");
  });
});

/* ========== compressActions 测试 ========== */

describe("compressActions", () => {
  test("将指定 actions 移到新子节点", () => {
    const p = createProcess("任务");
    const act1 = { id: "act1", type: "thought" as const, content: "思考1", timestamp: Date.now() };
    const act2 = { id: "act2", type: "thought" as const, content: "思考2", timestamp: Date.now() };
    const act3 = { id: "act3", type: "program" as const, content: "code1", success: true, result: "ok", timestamp: Date.now() };
    const act4 = { id: "act4", type: "thought" as const, content: "思考3", timestamp: Date.now() };

    appendAction(p, p.root.id, act1);
    appendAction(p, p.root.id, act2);
    appendAction(p, p.root.id, act3);
    appendAction(p, p.root.id, act4);

    const actionIds = ["act1", "act2"];
    const childId = compressActions(p, p.root.id, actionIds);

    expect(childId).not.toBeNull();
    expect(p.root.actions.length).toBe(2);
    const child = findNode(p.root, childId!);
    expect(child!.actions.length).toBe(2);
    expect(child!.status).toBe("done");
    expect(child!.summary).toBeTruthy();
    expect(child!.hooks).toEqual([]); // 归档节点不需要 hooks
  });

  test("不能 compress 不存在的 actionIds", () => {
    const p = createProcess("任务");
    appendAction(p, p.root.id, { id: "act1", type: "thought" as const, content: "思考1", timestamp: Date.now() });
    const childId = compressActions(p, p.root.id, ["nonexistent"]);
    expect(childId).toBeNull();
  });
});

/* ========== createFrameHook 测试 ========== */

describe("createFrameHook", () => {
  test("在指定节点注册 hook", () => {
    const p = createProcess("任务");
    const childId = addNode(p, p.root.id, "步骤 1")!;
    const ok = createFrameHook(p, childId, "when_stack_pop", "inject_message", "请确认子任务完成");
    expect(ok).toBe(true);
    const child = findNode(p.root, childId);
    expect(child!.hooks!.length).toBe(4); // 3 initial + 1 new
    expect(child!.hooks![3]!.handler).toBe("请确认子任务完成");
  });

  test("节点不存在返回 false", () => {
    const p = createProcess("任务");
    const ok = createFrameHook(p, "nonexistent", "when_stack_pop", "inject_message", "test");
    expect(ok).toBe(false);
  });
});

/* ========== collectFrameNodeHooks 测试 ========== */

import { collectFrameNodeHooks } from "../src/process/cognitive-stack.js";

describe("collectFrameNodeHooks", () => {
  test("收集 when_yield hooks (FIFO)", () => {
    const p = createProcess("任务");
    const hooks = collectFrameNodeHooks(p.root, "when_yield");
    expect(hooks.length).toBe(2); // summary + declare_running_processes
    expect(hooks[0]!.handler).toBe("summary");
    expect(hooks[1]!.handler).toBe("declare_running_processes");
  });

  test("收集 when_stack_pop hooks (LIFO)", () => {
    const p = createProcess("任务");
    createFrameHook(p, p.root.id, "when_stack_pop", "inject_message", "自定义 defer");
    const hooks = collectFrameNodeHooks(p.root, "when_stack_pop");
    expect(hooks.length).toBe(2);
    expect(hooks[0]!.handler).toBe("自定义 defer"); // LIFO: 后注册先执行
    expect(hooks[1]!.handler).toBe("summary");
  });

  test("收集不存在的 hook 时机返回空数组", () => {
    const p = createProcess("任务");
    const hooks = collectFrameNodeHooks(p.root, "when_error");
    expect(hooks.length).toBe(0);
  });

  test("节点无 hooks 字段返回空数组", () => {
    const p = createProcess("任务");
    const childId = addNode(p, p.root.id, "步骤 1")!;
    const child = findNode(p.root, childId)!;
    child.hooks = undefined;
    const hooks = collectFrameNodeHooks(child, "when_yield");
    expect(hooks.length).toBe(0);
  });
});

/* ========== thread CRUD 测试 ========== */

import { createThread, getThread, listThreads, goThread, initDefaultThreads } from "../src/process/thread.js";
import { sendSignal, ackSignal } from "../src/process/thread.js";

describe("createThread", () => {
  test("创建新线程", () => {
    const p = createProcess("任务");
    const ok = createThread(p, "backend", p.root.id);
    expect(ok).toBe(true);
    expect(p.threads!["backend"]!.status).toBe("running");
  });

  test("重复名称失败", () => {
    const p = createProcess("任务");
    createThread(p, "backend", p.root.id);
    const ok = createThread(p, "backend", p.root.id);
    expect(ok).toBe(false);
  });

  test("无效 focusId 失败", () => {
    const p = createProcess("任务");
    const ok = createThread(p, "backend", "nonexistent");
    expect(ok).toBe(false);
  });
});

describe("getThread", () => {
  test("获取线程", () => {
    const p = createProcess("任务");
    createThread(p, "frontend", p.root.id);
    const t = getThread(p, "frontend");
    expect(t).not.toBeNull();
    expect(t!.name).toBe("frontend");
  });

  test("不存在返回 null", () => {
    const p = createProcess("任务");
    expect(getThread(p, "nope")).toBeNull();
  });
});

describe("listThreads", () => {
  test("列出所有线程", () => {
    const p = createProcess("任务");
    createThread(p, "frontend", p.root.id);
    createThread(p, "backend", p.root.id);
    const threads = listThreads(p);
    expect(threads.length).toBe(2);
  });

  test("无线程返回空数组", () => {
    const p = createProcess("任务");
    expect(listThreads(p)).toEqual([]);
  });
});

/* ========== ThreadState / Signal 类型测试 ========== */

describe("ThreadState types", () => {
  test("ThreadState 结构正确", () => {
    const thread: ThreadState = {
      name: "backend",
      focusId: "node_1",
      status: "running",
      signals: [],
    };
    expect(thread.status).toBe("running");
  });

  test("Signal 结构正确", () => {
    const sig: Signal = {
      id: "sig_1",
      from: "frontend",
      content: "用户发来新消息",
      timestamp: Date.now(),
      acked: false,
    };
    expect(sig.acked).toBe(false);
  });
});

/* ========== signal 通信测试 ========== */

describe("sendSignal", () => {
  test("发送信号到目标线程", () => {
    const p = createProcess("任务");
    createThread(p, "frontend", p.root.id);
    createThread(p, "backend", p.root.id);
    const sigId = sendSignal(p, "frontend", "backend", "用户发来新消息");
    expect(sigId).not.toBeNull();
    const backend = getThread(p, "backend")!;
    expect(backend.signals.length).toBe(1);
    expect(backend.signals[0]!.content).toBe("用户发来新消息");
    expect(backend.signals[0]!.acked).toBe(false);
  });

  test("目标线程不存在返回 null", () => {
    const p = createProcess("任务");
    createThread(p, "frontend", p.root.id);
    const sigId = sendSignal(p, "frontend", "nonexistent", "hello");
    expect(sigId).toBeNull();
  });

  test("发送方线程不存在返回 null", () => {
    const p = createProcess("任务");
    createThread(p, "backend", p.root.id);
    const sigId = sendSignal(p, "nonexistent", "backend", "hello");
    expect(sigId).toBeNull();
  });
});

describe("ackSignal", () => {
  test("确认信号", () => {
    const p = createProcess("任务");
    createThread(p, "frontend", p.root.id);
    createThread(p, "backend", p.root.id);
    const sigId = sendSignal(p, "frontend", "backend", "请处理")!;
    const ok = ackSignal(p, "backend", sigId, "已收到，开始处理");
    expect(ok).toBe(true);
    const backend = getThread(p, "backend")!;
    expect(backend.signals[0]!.acked).toBe(true);
    expect(backend.signals[0]!.ackMemo).toBe("已收到，开始处理");
  });

  test("重复确认失败", () => {
    const p = createProcess("任务");
    createThread(p, "frontend", p.root.id);
    createThread(p, "backend", p.root.id);
    const sigId = sendSignal(p, "frontend", "backend", "请处理")!;
    ackSignal(p, "backend", sigId);
    const ok = ackSignal(p, "backend", sigId);
    expect(ok).toBe(false);
  });

  test("线程不存在返回 false", () => {
    const p = createProcess("任务");
    const ok = ackSignal(p, "nonexistent", "sig_fake");
    expect(ok).toBe(false);
  });

  test("signal 不存在返回 false", () => {
    const p = createProcess("任务");
    createThread(p, "backend", p.root.id);
    const ok = ackSignal(p, "backend", "sig_fake");
    expect(ok).toBe(false);
  });
});

/* ========== goThread 测试 ========== */

describe("goThread", () => {
  test("切换到目标线程", () => {
    const p = createProcess("任务");
    const childId = addNode(p, p.root.id, "子任务")!;
    createThread(p, "frontend", p.root.id);
    createThread(p, "backend", childId);
    const result = goThread(p, "backend");
    expect(result.success).toBe(true);
    expect(p.threads!["frontend"]!.status).toBe("yielded");
    expect(p.threads!["backend"]!.status).toBe("running");
    expect(p.focusId).toBe(childId);
  });

  test("切换到同一线程不触发 yield", () => {
    const p = createProcess("任务");
    createThread(p, "frontend", p.root.id);
    const result = goThread(p, "frontend");
    expect(result.success).toBe(true);
    expect(result.yieldedNodeId).toBeUndefined();
    expect(p.threads!["frontend"]!.status).toBe("running");
  });

  test("切换到不存在的线程失败", () => {
    const p = createProcess("任务");
    const result = goThread(p, "nonexistent");
    expect(result.success).toBe(false);
  });

  test("切换到 finished 线程失败", () => {
    const p = createProcess("任务");
    createThread(p, "frontend", p.root.id);
    p.threads!["frontend"]!.status = "finished";
    const result = goThread(p, "frontend");
    expect(result.success).toBe(false);
  });

  test("goThread 带 nodeId 移动线程内 focus", () => {
    const p = createProcess("任务");
    const childId = addNode(p, p.root.id, "子任务")!;
    createThread(p, "frontend", p.root.id);
    const result = goThread(p, "frontend", childId);
    expect(result.success).toBe(true);
    expect(p.threads!["frontend"]!.focusId).toBe(childId);
    expect(p.focusId).toBe(childId);
  });
});

/* ========== initDefaultThreads 测试 ========== */

describe("initDefaultThreads", () => {
  test("创建 frontend 和 backend 线程", () => {
    const p = createProcess("任务");
    const ok = initDefaultThreads(p);
    expect(ok).toBe(true);
    expect(Object.keys(p.threads!).length).toBe(2);
    expect(p.threads!["frontend"]!.status).toBe("running");
    expect(p.threads!["backend"]!.status).toBe("yielded");
    expect(p.threads!["frontend"]!.focusId).toBe(p.focusId);
    expect(p.threads!["backend"]!.focusId).toBe(p.focusId);
  });

  test("已有线程时不重复初始化", () => {
    const p = createProcess("任务");
    initDefaultThreads(p);
    const ok = initDefaultThreads(p);
    expect(ok).toBe(false);
  });
});
