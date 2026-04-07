/**
 * 线程指令解析器测试
 *
 * 验证从 LLM 输出中提取新线程 API 指令的能力。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#4
 */
import { describe, test, expect } from "bun:test";
import {
  parseThreadOutput,
  type ThreadParsedOutput,
} from "../src/thread/parser.js";

describe("parseThreadOutput", () => {
  test("解析 create_sub_thread 指令", () => {
    const input = `
[thought]
content = "需要并行搜索两个主题"

[create_sub_thread]
title = "搜索 AI Safety"
description = "搜索 AI Safety 相关论文"
traits = ["academic_writing"]
`;
    const result = parseThreadOutput(input);
    expect(result.thought).toBe("需要并行搜索两个主题");
    expect(result.createSubThread).not.toBeNull();
    expect(result.createSubThread!.title).toBe("搜索 AI Safety");
    expect(result.createSubThread!.description).toBe("搜索 AI Safety 相关论文");
    expect(result.createSubThread!.traits).toEqual(["academic_writing"]);
  });

  test("解析 return 指令", () => {
    const input = `
[thought]
content = "任务完成，返回结果"

[return]
summary = "找到 3 篇相关论文"

[return.artifacts]
papers = ["paper1.pdf", "paper2.pdf", "paper3.pdf"]
count = 3
`;
    const result = parseThreadOutput(input);
    expect(result.threadReturn).not.toBeNull();
    expect(result.threadReturn!.summary).toBe("找到 3 篇相关论文");
    expect(result.threadReturn!.artifacts).toBeDefined();
    expect(result.threadReturn!.artifacts!.count).toBe(3);
  });

  test("解析 await 指令（单个）", () => {
    const input = `
[await]
thread_id = "thread_abc123"
`;
    const result = parseThreadOutput(input);
    expect(result.awaitThreads).toEqual(["thread_abc123"]);
  });

  test("解析 await_all 指令（多个）", () => {
    const input = `
[await_all]
thread_ids = ["thread_a", "thread_b", "thread_c"]
`;
    const result = parseThreadOutput(input);
    expect(result.awaitThreads).toEqual(["thread_a", "thread_b", "thread_c"]);
  });

  test("解析 mark 指令", () => {
    const input = `
[mark]
message_id = "msg_001"
type = "todo"
tip = "需要后续跟进"
`;
    const result = parseThreadOutput(input);
    expect(result.mark).not.toBeNull();
    expect(result.mark!.messageId).toBe("msg_001");
    expect(result.mark!.type).toBe("todo");
    expect(result.mark!.tip).toBe("需要后续跟进");
  });

  test("解析 addTodo 指令", () => {
    const input = `
[addTodo]
content = "回复 A 的消息"
source_message_id = "msg_002"
`;
    const result = parseThreadOutput(input);
    expect(result.addTodo).not.toBeNull();
    expect(result.addTodo!.content).toBe("回复 A 的消息");
    expect(result.addTodo!.sourceMessageId).toBe("msg_002");
  });

  test("解析 set_plan 指令", () => {
    const input = `
[set_plan]
text = "1. 搜索论文 2. 整理摘要 3. 返回结果"
`;
    const result = parseThreadOutput(input);
    expect(result.setPlan).toBe("1. 搜索论文 2. 整理摘要 3. 返回结果");
  });

  test("解析 program 段（复用旧逻辑）", () => {
    const input = `
[program]
code = """
const result = await search("AI Safety");
print(result);
"""
`;
    const result = parseThreadOutput(input);
    expect(result.program).not.toBeNull();
    expect(result.program!.code).toContain("search");
  });

  test("解析 talk 段（复用旧逻辑）", () => {
    const input = `
[talk]
target = "researcher"
message = "请帮我搜索 AI Safety 论文"
`;
    const result = parseThreadOutput(input);
    expect(result.talk).not.toBeNull();
    expect(result.talk!.target).toBe("researcher");
    expect(result.talk!.message).toContain("AI Safety");
  });

  test("无有效指令时返回空结果", () => {
    const input = "这是一段普通文本，没有任何指令。";
    const result = parseThreadOutput(input);
    expect(result.thought).toBeUndefined();
    expect(result.program).toBeNull();
    expect(result.createSubThread).toBeNull();
    expect(result.threadReturn).toBeNull();
    expect(result.awaitThreads).toBeNull();
  });

  test("同时包含 thought + program + create_sub_thread", () => {
    const input = `
[thought]
content = "先执行搜索，再创建子线程分析"

[program]
code = "const data = await fetch('/api');"

[create_sub_thread]
title = "分析数据"
`;
    const result = parseThreadOutput(input);
    expect(result.thought).toBeDefined();
    expect(result.program).not.toBeNull();
    expect(result.createSubThread).not.toBeNull();
    expect(result.createSubThread!.title).toBe("分析数据");
  });
});
