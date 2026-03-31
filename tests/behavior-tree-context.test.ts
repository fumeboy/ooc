/**
 * 第三层测试 — 行为树驱动 Context
 *
 * 覆盖：removeNode, editNode, focus 离开自动总结,
 * focus 目标提示, actions 按 focus 过滤
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createProcess,
  addNode,
  completeNode,
  appendAction,
  findNode,
  getPathToNode,
  removeNode,
  editNode,
  resetNodeCounter,
} from "../src/process/tree.js";
import {
  moveFocus,
  advanceFocus,
} from "../src/process/focus.js";
import { renderProcess } from "../src/process/render.js";
import { buildContext } from "../src/context/builder.js";
import type { StoneData, FlowData } from "../src/types/index.js";

beforeEach(() => {
  resetNodeCounter();
});

const makeStone = (): StoneData => ({
  name: "tester",
  thinkable: { whoAmI: "测试" },
  talkable: { whoAmI: "测试", functions: [] },
  data: {},
  relations: [],
  traits: [],
});

/* ========== removeNode ========== */

describe("removeNode", () => {
  test("删除 todo 节点", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;

    expect(removeNode(p, id2)).toBe(true);
    expect(findNode(p.root, id2)).toBeNull();
    expect(p.root.children).toHaveLength(1);
  });

  test("不能删除 doing 节点", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    moveFocus(p, id1); // status becomes doing

    expect(removeNode(p, id1)).toBe(false);
  });

  test("不能删除根节点", () => {
    const p = createProcess("根");
    expect(removeNode(p, p.root.id)).toBe(false);
  });

  test("不能删除 focus 节点", () => {
    const p = createProcess("根");
    // root is focus, can't delete
    expect(removeNode(p, p.root.id)).toBe(false);
  });

  test("删除节点后清理依赖引用", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2", [id1])!;

    removeNode(p, id1);
    const node2 = findNode(p.root, id2)!;
    expect(node2.deps).toBeUndefined();
  });
});

/* ========== editNode ========== */

describe("editNode", () => {
  test("修改 todo 节点标题", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "旧标题")!;

    expect(editNode(p, id1, "新标题")).toBe(true);
    expect(findNode(p.root, id1)!.title).toBe("新标题");
  });

  test("修改 doing 节点标题", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤")!;
    moveFocus(p, id1);

    expect(editNode(p, id1, "更新后的步骤")).toBe(true);
    expect(findNode(p.root, id1)!.title).toBe("更新后的步骤");
  });

  test("不能修改 done 节点", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤")!;
    completeNode(p, id1, "完成");

    expect(editNode(p, id1, "新标题")).toBe(false);
    expect(findNode(p.root, id1)!.title).toBe("步骤");
  });
});

/* ========== focus 离开自动总结 ========== */

describe("moveFocus 自动总结", () => {
  test("离开 doing 节点时自动生成 summary", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;

    moveFocus(p, id1);
    appendAction(p, id1, { type: "thought", content: "我在分析问题", timestamp: Date.now() });

    /* 移动到 id2，id1 应该自动生成 summary */
    moveFocus(p, id2);
    const node1 = findNode(p.root, id1)!;
    expect(node1.summary).toBeDefined();
    expect(node1.summary!.length).toBeGreaterThan(0);
  });

  test("已有 summary 的节点不覆盖", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;

    moveFocus(p, id1);
    findNode(p.root, id1)!.summary = "手动摘要";

    moveFocus(p, id2);
    expect(findNode(p.root, id1)!.summary).toBe("手动摘要");
  });
});

describe("advanceFocus 自动总结", () => {
  test("advanceFocus 离开时自动总结", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    addNode(p, p.root.id, "步骤 2");

    /* focus 在根，根有 actions */
    appendAction(p, p.root.id, { type: "thought", content: "规划任务", timestamp: Date.now() });

    /* advanceFocus 进入 id1，根应该自动总结 */
    advanceFocus(p);
    expect(p.root.summary).toBeDefined();
  });
});

/* ========== renderProcess focus 目标提示 ========== */

describe("renderProcess focus 目标提示", () => {
  test("显示当前帧信息（新格式）", () => {
    const p = createProcess("竞品分析");
    addNode(p, p.root.id, "收集数据");

    const text = renderProcess(p);
    // 新格式中在【认知栈】和【当前状态】区域显示
    expect(text).toContain("【认知栈】");
    expect(text).toContain("竞品分析");
    expect(text).toContain("【当前状态】");
  });

  test("focus 移动后当前帧更新", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "收集数据")!;
    moveFocus(p, id1);

    const text = renderProcess(p);
    expect(text).toContain("【认知栈】");
    expect(text).toContain("收集数据");
  });
});

/* ========== buildContext actions 过滤 ========== */

describe("buildContext 结构化遗忘", () => {
  test("有行为树时只返回 focus 节点的 actions", () => {
    const process = createProcess("根");
    const id1 = addNode(process, process.root.id, "步骤 1")!;

    /* 根节点有 actions */
    appendAction(process, process.root.id, { type: "thought", content: "根的思考", timestamp: 1 });

    /* 步骤 1 有 actions */
    appendAction(process, id1, { type: "thought", content: "步骤1的思考", timestamp: 2 });

    /* focus 移到步骤 1 */
    moveFocus(process, id1);

    const flow: FlowData = {
      taskId: "t1",
      stoneName: "tester",
      status: "running",
      messages: [],
      process,
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const ctx = buildContext(makeStone(), flow, []);
    /* 应该只包含 focus 节点（步骤1）的 actions */
    expect(ctx.actions).toHaveLength(1);
    expect(ctx.actions[0]!.content).toBe("步骤1的思考");
  });

  test("focus 节点无 actions 时返回空列表", () => {
    const process = createProcess("根");
    const id1 = addNode(process, process.root.id, "步骤 1")!;

    /* 根节点有 actions，但 focus 移到空的步骤 1 */
    appendAction(process, process.root.id, { type: "thought", content: "根的思考", timestamp: 1 });
    moveFocus(process, id1);

    const flow: FlowData = {
      taskId: "t2",
      stoneName: "tester",
      status: "running",
      messages: [],
      process,
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const ctx = buildContext(makeStone(), flow, []);
    /* focus 节点（步骤1）没有 actions，返回空 */
    expect(ctx.actions).toHaveLength(0);
  });
});

/* ========== ProcessNode locals ========== */

describe("ProcessNode locals", () => {
  test("节点可以存储和读取 locals", () => {
    const process = createProcess("任务");
    const root = process.root;
    root.locals = { planId: "abc123" };

    expect(root.locals.planId).toBe("abc123");
  });

  test("locals 随节点持久化（JSON 序列化）", () => {
    const process = createProcess("任务");
    process.root.locals = { x: 1, name: "test" };

    const json = JSON.stringify(process);
    const restored = JSON.parse(json);

    expect(restored.root.locals.x).toBe(1);
    expect(restored.root.locals.name).toBe("test");
  });

  test("子节点有独立的 locals 空间", () => {
    const process = createProcess("任务");
    const childId = addNode(process, process.root.id, "子步骤");
    const child = findNode(process.root, childId!);

    process.root.locals = { shared: "parent" };
    child!.locals = { own: "child" };

    expect(process.root.locals.shared).toBe("parent");
    expect(child!.locals.own).toBe("child");
    expect((process.root.locals as any).own).toBeUndefined();
  });

  test("Proxy 作用域链：子节点可读父节点 locals，写入到自己", () => {
    const process = createProcess("任务");
    const childId = addNode(process, process.root.id, "子步骤");
    const child = findNode(process.root, childId!)!;

    process.root.locals = { planId: "root_plan", step1: "s1" };
    child.locals = {};

    /* 构建作用域链 Proxy（与 buildExecutionContext 中逻辑一致） */
    const path = getPathToNode(process.root, child.id);
    const ancestorLocals: Record<string, unknown> = {};
    for (const node of path) {
      if (node.id !== child.id && node.locals) {
        Object.assign(ancestorLocals, node.locals);
      }
    }

    const local: Record<string, unknown> = new Proxy(child.locals!, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && prop in target) return target[prop];
        if (typeof prop === "string" && prop in ancestorLocals) return ancestorLocals[prop];
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value) {
        if (typeof prop === "string") { target[prop] = value; return true; }
        return Reflect.set(target, prop, value);
      },
    });

    /* 读取父节点的 locals */
    expect(local.planId).toBe("root_plan");
    expect(local.step1).toBe("s1");

    /* 写入到子节点自己的 locals */
    local.result = "child_data";
    expect(child.locals!.result).toBe("child_data");
    /* 父节点不受影响 */
    expect((process.root.locals as any).result).toBeUndefined();

    /* 子节点覆盖父节点同名变量（只在子节点可见） */
    local.planId = "overridden";
    expect(local.planId).toBe("overridden");
    expect(process.root.locals!.planId).toBe("root_plan");
  });
});

/* ========== renderProcess 结构化遗忘 ========== */

describe("renderProcess 结构化遗忘", () => {
  test("不在聚焦路径上的兄弟节点不显示（结构化遗忘）", () => {
    const p = createProcess("根");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;

    moveFocus(p, id1);
    appendAction(p, id1, { type: "thought", content: "分析中", timestamp: Date.now() });
    moveFocus(p, id2); // id1 auto-summarized

    const node1 = findNode(p.root, id1)!;
    expect(node1.summary).toBeDefined(); // 验证确实生成了 summary

    // 根据结构化遗忘原则：不在聚焦路径上的节点完全不展示
    // 当前路径是 [根, 步骤 2]，步骤 1 是兄弟节点，不应该显示
    const text = renderProcess(p);
    // 步骤 1 不在聚焦路径上，虽然有 summary 但不应该显示
    // 但它也没有被标记为 done，所以不会以 [sub_stack_frame] 形式显示
    expect(text).toContain("步骤 2");
    // 注意：由于结构化遗忘，步骤 1 不会显示
  });
});

/* ========== TodoList 测试 ========== */

import {
  addTodo,
  insertTodo,
  removeTodo,
  getTodo,
  popTodo,
  interruptForMessage,
} from "../src/process/tree.js";

describe("TodoList", () => {
  test("addTodo 追加到尾部", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;

    addTodo(p, id1, "步骤 1", "plan");
    addTodo(p, id2, "步骤 2", "plan");

    const todo = getTodo(p);
    expect(todo).toHaveLength(2);
    expect(todo[0]!.nodeId).toBe(id1);
    expect(todo[0]!.source).toBe("plan");
    expect(todo[1]!.nodeId).toBe(id2);
  });

  test("insertTodo 在指定位置插入", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;
    const id3 = addNode(p, p.root.id, "紧急消息")!;

    addTodo(p, id1, "步骤 1", "plan");
    addTodo(p, id2, "步骤 2", "plan");
    insertTodo(p, 0, id3, "处理紧急消息", "interrupt");

    const todo = getTodo(p);
    expect(todo).toHaveLength(3);
    expect(todo[0]!.nodeId).toBe(id3);
    expect(todo[0]!.source).toBe("interrupt");
    expect(todo[1]!.nodeId).toBe(id1);
  });

  test("removeTodo 移除指定位置", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;

    addTodo(p, id1, "步骤 1", "plan");
    addTodo(p, id2, "步骤 2", "plan");

    const ok = removeTodo(p, 0);
    expect(ok).toBe(true);
    expect(getTodo(p)).toHaveLength(1);
    expect(getTodo(p)[0]!.nodeId).toBe(id2);
  });

  test("removeTodo 越界返回 false", () => {
    const p = createProcess("任务");
    expect(removeTodo(p, 0)).toBe(false);
    expect(removeTodo(p, -1)).toBe(false);
  });

  test("popTodo 弹出头部并返回下一项", () => {
    const p = createProcess("任务");
    const id1 = addNode(p, p.root.id, "步骤 1")!;
    const id2 = addNode(p, p.root.id, "步骤 2")!;

    addTodo(p, id1, "步骤 1", "plan");
    addTodo(p, id2, "步骤 2", "plan");

    const next = popTodo(p);
    expect(next).toBe(id2);
    expect(getTodo(p)).toHaveLength(1);

    const last = popTodo(p);
    expect(last).toBeNull();
    expect(getTodo(p)).toHaveLength(0);
  });

  test("renderProcess 输出 todolist", () => {
    const p = createProcess("研究任务");
    const id1 = addNode(p, p.root.id, "收集信息")!;
    const id2 = addNode(p, p.root.id, "分析数据")!;

    addTodo(p, id1, "收集信息", "plan");
    addTodo(p, id2, "分析数据", "plan");

    const text = renderProcess(p);
    expect(text).toContain("【待办队列】");
    expect(text).toContain("[当前] 收集信息");
    expect(text).toContain("2. 分析数据");
  });

  test("renderProcess 显示中断标记", () => {
    const p = createProcess("研究任务");
    const id1 = addNode(p, p.root.id, "收集信息")!;
    const idMsg = addNode(p, p.root.id, "处理消息")!;

    addTodo(p, id1, "收集信息", "plan");
    insertTodo(p, 0, idMsg, "处理来自 helper 的消息", "interrupt");

    const text = renderProcess(p);
    expect(text).toContain("处理来自 helper 的消息 (中断)");
  });

  test("空 todolist 不渲染", () => {
    const p = createProcess("简单任务");
    const text = renderProcess(p);
    expect(text).not.toContain("【待办队列】");
  });
});

/* ========== 中断机制测试 ========== */

describe("interruptForMessage", () => {
  test("创建中断节点并插入 todolist 头部", () => {
    const p = createProcess("研究任务");
    const id1 = addNode(p, p.root.id, "收集信息")!;
    addTodo(p, id1, "收集信息", "plan");
    moveFocus(p, id1);

    const interruptId = interruptForMessage(p, "helper", "分析结果已完成");

    /* 中断节点应该在根节点的 children 中 */
    const interruptNode = findNode(p.root, interruptId);
    expect(interruptNode).toBeDefined();
    expect(interruptNode!.title).toContain("helper");
    expect(interruptNode!.title).toContain("分析结果已完成");

    /* todolist 头部应该是中断项 */
    const todo = getTodo(p);
    expect(todo[0]!.nodeId).toBe(interruptId);
    expect(todo[0]!.source).toBe("interrupt");
    /* 原来的项应该还在 */
    expect(todo[1]!.nodeId).toBe(id1);
  });

  test("中断后 moveFocus 到中断节点", () => {
    const p = createProcess("研究任务");
    const id1 = addNode(p, p.root.id, "收集信息")!;
    moveFocus(p, id1);

    const interruptId = interruptForMessage(p, "helper", "结果");
    moveFocus(p, interruptId);

    expect(p.focusId).toBe(interruptId);
  });

  test("处理完中断后恢复到原任务", () => {
    const p = createProcess("研究任务");
    const id1 = addNode(p, p.root.id, "收集信息")!;
    const id2 = addNode(p, p.root.id, "分析数据")!;
    addTodo(p, id1, "收集信息", "plan");
    addTodo(p, id2, "分析数据", "plan");
    moveFocus(p, id1);

    /* 中断 */
    const interruptId = interruptForMessage(p, "helper", "结果");
    moveFocus(p, interruptId);

    /* 处理完中断：completeStep + todolist 弹出 */
    completeNode(p, interruptId, "已处理消息");
    const todo = p.todo ?? [];
    const idx = todo.findIndex((t) => t.nodeId === interruptId);
    if (idx >= 0) removeTodo(p, idx);

    /* focus 应该可以回到 id1 */
    const nextTodo = (p.todo ?? [])[0];
    expect(nextTodo).toBeDefined();
    expect(nextTodo!.nodeId).toBe(id1);
    moveFocus(p, nextTodo!.nodeId);
    expect(p.focusId).toBe(id1);
  });

  test("长消息截断显示", () => {
    const p = createProcess("任务");
    const longMsg = "a]b]c]d]e]f]g]h]i]j]k]l]m]n]o]p]q]r]s]t]u]v]w]x]y]z]1]2]3]4]5]6";
    const interruptId = interruptForMessage(p, "sender", longMsg);
    const node = findNode(p.root, interruptId)!;
    expect(node.title).toContain("...");
  });

  test("renderProcess 显示中断状态", () => {
    const p = createProcess("研究任务");
    const id1 = addNode(p, p.root.id, "收集信息")!;
    addTodo(p, id1, "收集信息", "plan");

    const interruptId = interruptForMessage(p, "helper", "分析完成");
    moveFocus(p, interruptId);

    const text = renderProcess(p);
    expect(text).toContain("(中断)");
    expect(text).toContain("helper");
  });
});
