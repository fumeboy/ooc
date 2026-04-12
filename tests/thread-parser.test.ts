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
mark_message_id = "msg_123"
mark_type = "ack"
mark_tip = "已回复"
`;
    const result = parseThreadOutput(input);
    expect(result.talk).not.toBeNull();
    expect(result.talk!.target).toBe("researcher");
    expect(result.talk!.message).toContain("AI Safety");
    expect(result.talk!.mark).toBeDefined();
    expect(result.talk!.mark!.message_ids).toEqual(["msg_123"]);
    expect(result.talk!.mark!.type).toBe("ack");
    expect(result.talk!.mark!.tip).toBe("已回复");
  });

  test("解析 talk 段：支持 mark_message_ids 数组", () => {
    const input = `
[talk]
target = "researcher"
message = "收到"
mark_message_ids = ["msg_a", "msg_b"]
mark_type = "ack"
mark_tip = "已回复"
`;
    const result = parseThreadOutput(input);
    expect(result.talk).not.toBeNull();
    expect(result.talk!.mark).toBeDefined();
    expect(result.talk!.mark!.message_ids).toEqual(["msg_a", "msg_b"]);
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

  test("解析 continue_sub_thread 指令", () => {
    const input = `
[thought]
content = "子线程结果不够全面，需要追问"

[continue_sub_thread]
thread_id = "th_abc123"
message = "请补充 2024 年之后的论文"
`;
    const result = parseThreadOutput(input);
    expect(result.thought).toBe("子线程结果不够全面，需要追问");
    expect(result.continueSubThread).not.toBeNull();
    expect(result.continueSubThread!.threadId).toBe("th_abc123");
    expect(result.continueSubThread!.message).toBe("请补充 2024 年之后的论文");
  });

  test("continue_sub_thread 缺少字段时返回空字符串", () => {
    const input = `
[continue_sub_thread]
thread_id = "th_xyz"
`;
    const result = parseThreadOutput(input);
    expect(result.continueSubThread).not.toBeNull();
    expect(result.continueSubThread!.threadId).toBe("th_xyz");
    expect(result.continueSubThread!.message).toBe("");
  });
});

describe("parseThreadOutput — use_skill", () => {
  test("解析 use_skill 指令", () => {
    const input = `
[use_skill]
name = "commit"
`;
    const result = parseThreadOutput(input);
    expect(result.useSkill).not.toBeNull();
    expect(result.useSkill!.name).toBe("commit");
  });

  test("use_skill 缺少 name 时为 null", () => {
    const input = `
[use_skill]
foo = "bar"
`;
    const result = parseThreadOutput(input);
    expect(result.useSkill).toBeNull();
  });

  test("use_skill 可与 thought 共存", () => {
    const input = `
[thought]
content = "需要加载 commit skill"

[use_skill]
name = "commit"
`;
    const result = parseThreadOutput(input);
    expect(result.thought).toBe("需要加载 commit skill");
    expect(result.useSkill).not.toBeNull();
    expect(result.useSkill!.name).toBe("commit");
  });
});

describe("parseThreadOutput — form operations", () => {
  test("解析 [talk.begin]", () => {
    const input = `
[talk.begin]
description = "通知 sophia"
`;
    const result = parseThreadOutput(input);
    expect(result.formBegin).not.toBeNull();
    expect(result.formBegin!.command).toBe("talk");
    expect(result.formBegin!.description).toBe("通知 sophia");
  });

  test("解析 [talk.submit]", () => {
    const input = `
[talk.submit]
form_id = "f_001"
target = "sophia"
message = "G1 已更新"
`;
    const result = parseThreadOutput(input);
    expect(result.formSubmit).not.toBeNull();
    expect(result.formSubmit!.command).toBe("talk");
    expect(result.formSubmit!.formId).toBe("f_001");
    expect(result.formSubmit!.params.target).toBe("sophia");
    expect(result.formSubmit!.params.message).toBe("G1 已更新");
  });

  test("解析 [program.cancel]", () => {
    const input = `
[program.cancel]
form_id = "f_002"
`;
    const result = parseThreadOutput(input);
    expect(result.formCancel).not.toBeNull();
    expect(result.formCancel!.command).toBe("program");
    expect(result.formCancel!.formId).toBe("f_002");
  });

  test("form 操作与旧指令共存（兼容期）", () => {
    const input = `
[return]
summary = "done"
`;
    const result = parseThreadOutput(input);
    expect(result.threadReturn).not.toBeNull();
    expect(result.formBegin).toBeNull();
  });

  test("[talk] 与 [talk.begin] 共存时两者都能解析", () => {
    const input = `
[talk]
target = "sophia"
message = "hello"

[talk.begin]
description = "准备发送消息"
`;
    const result = parseThreadOutput(input);
    expect(result.talk).not.toBeNull();
    expect(result.talk!.target).toBe("sophia");
    expect(result.formBegin).not.toBeNull();
    expect(result.formBegin!.command).toBe("talk");
    expect(result.formBegin!.description).toBe("准备发送消息");
  });

  test("submit params 不包含 form_id", () => {
    const input = `
[talk.submit]
form_id = "f_003"
target = "sophia"
message = "hi"
priority = 1
`;
    const result = parseThreadOutput(input);
    expect(result.formSubmit).not.toBeNull();
    expect(result.formSubmit!.params).not.toHaveProperty("form_id");
    expect(result.formSubmit!.params.target).toBe("sophia");
    expect(result.formSubmit!.params.priority).toBe(1);
  });
});

describe("parseThreadOutput — call_function form", () => {
  test("解析 [call_function.begin] 含 trait 和 function_name", () => {
    const input = `
[call_function.begin]
trait = "kernel/computable/file_ops"
function_name = "readFile"
description = "读取 meta.md"
`;
    const result = parseThreadOutput(input);
    expect(result.formBegin).not.toBeNull();
    expect(result.formBegin!.command).toBe("call_function");
    expect(result.formBegin!.trait).toBe("kernel/computable/file_ops");
    expect(result.formBegin!.functionName).toBe("readFile");
    expect(result.formBegin!.description).toBe("读取 meta.md");
  });

  test("解析 [call_function.submit] 含 args（子表写法）", () => {
    const input = `
[call_function.submit]
form_id = "f_001"

[call_function.submit.args]
path = "docs/meta.md"
limit = 100
`;
    const result = parseThreadOutput(input);
    expect(result.formSubmit).not.toBeNull();
    expect(result.formSubmit!.command).toBe("call_function");
    expect(result.formSubmit!.formId).toBe("f_001");
    expect(result.formSubmit!.params.args).toBeDefined();
    const args = result.formSubmit!.params.args as Record<string, unknown>;
    expect(args.path).toBe("docs/meta.md");
    expect(args.limit).toBe(100);
  });

  test("解析 [call_function.submit] 含 args（内联表写法）", () => {
    const input = `
[call_function.submit]
form_id = "f_002"
args = { path = "docs/meta.md", limit = 50 }
`;
    const result = parseThreadOutput(input);
    expect(result.formSubmit).not.toBeNull();
    expect(result.formSubmit!.command).toBe("call_function");
    expect(result.formSubmit!.formId).toBe("f_002");
    const args = result.formSubmit!.params.args as Record<string, unknown>;
    expect(args.path).toBe("docs/meta.md");
    expect(args.limit).toBe(50);
  });
});
