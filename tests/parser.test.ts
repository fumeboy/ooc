/**
 * 程序解析器测试
 */

import { describe, test, expect } from "bun:test";
import { createLLMOutputStreamParser, extractPrograms, detectDirectives, extractReplyContent, parseLLMOutput } from "../src/flow/parser.js";

describe("extractPrograms", () => {
  test("提取单个 JavaScript 代码块", () => {
    const output = `我来搜索一下。

\`\`\`javascript
const result = await search("AI safety");
print(result);
\`\`\`

让我分析结果。`;

    const programs = extractPrograms(output);
    expect(programs).toHaveLength(1);
    expect(programs[0]!.code).toContain('search("AI safety")');
  });

  test("提取多个代码块", () => {
    const output = `第一步：

\`\`\`javascript
print("hello");
\`\`\`

第二步：

\`\`\`js
print("world");
\`\`\``;

    const programs = extractPrograms(output);
    expect(programs).toHaveLength(2);
    expect(programs[0]!.code).toContain("hello");
    expect(programs[1]!.code).toContain("world");
  });

  test("忽略非 JavaScript 代码块", () => {
    const output = `\`\`\`python
print("not js")
\`\`\`

\`\`\`javascript
print("is js");
\`\`\``;

    const programs = extractPrograms(output);
    expect(programs).toHaveLength(1);
    expect(programs[0]!.code).toContain("is js");
  });

  test("无代码块返回空列表", () => {
    const output = "这是一段普通文本，没有代码。";
    const programs = extractPrograms(output);
    expect(programs).toHaveLength(0);
  });

  test("忽略空代码块", () => {
    const output = `\`\`\`javascript
\`\`\``;

    const programs = extractPrograms(output);
    expect(programs).toHaveLength(0);
  });
});

describe("detectDirectives", () => {
  test("检测 [finish]", () => {
    const d = detectDirectives("任务完成了 [finish]");
    expect(d.finish).toBe(true);
    expect(d.break_).toBe(false);
    expect(d.wait).toBe(false);
  });

  test("检测 [wait]", () => {
    const d = detectDirectives("需要更多信息 [wait]");
    expect(d.wait).toBe(true);
  });

  test("检测 [break]", () => {
    const d = detectDirectives("中断 [break]");
    expect(d.break_).toBe(true);
  });

  test("无指令", () => {
    const d = detectDirectives("普通文本");
    expect(d.finish).toBe(false);
    expect(d.break_).toBe(false);
    expect(d.wait).toBe(false);
  });
});

describe("extractReplyContent", () => {
  test("移除 [finish] 指令", () => {
    const reply = extractReplyContent("任务完成了。\n[finish]");
    expect(reply).toBe("任务完成了。");
    expect(reply).not.toContain("[finish]");
  });

  test("移除 [wait] 指令", () => {
    const reply = extractReplyContent("\n[wait]");
    expect(reply).toBe("");
  });

  test("移除代码块", () => {
    const reply = extractReplyContent("结果如下：\n```javascript\nprint('hello');\n```\n[finish]");
    expect(reply).toBe("结果如下：");
  });

  test("移除系统标签", () => {
    const reply = extractReplyContent("[SYSTEM] 内部信息 </think>\n你好！\n[finish]");
    expect(reply).toContain("内部信息");
    expect(reply).toContain("你好！");
    expect(reply).not.toContain("[SYSTEM]");
    expect(reply).not.toContain("</think>");
    expect(reply).not.toContain("[finish]");
  });

  test("纯指令时回退到 print 输出", () => {
    const reply = extractReplyContent("[finish]", ["这是 print 的输出"]);
    expect(reply).toBe("这是 print 的输出");
  });

  test("有文本时不使用 print 输出", () => {
    const reply = extractReplyContent("我的回复\n[finish]", ["print 输出"]);
    expect(reply).toBe("我的回复");
  });

  test("无内容无 print 返回空字符串", () => {
    const reply = extractReplyContent("[wait]");
    expect(reply).toBe("");
  });
});

describe("parseLLMOutput — 禁止 [thought] 协议", () => {
  test("assistant 输出 legacy [thought] 段落时报协议错误", () => {
    expect(() => parseLLMOutput(`[thought]\n这是不允许的\n\n[finish]`)).toThrow(
      /deprecated \[thought\] section: use model-native thinking instead/i,
    );
  });

  test("assistant 输出 TOML [thought] 段落时报协议错误", () => {
    expect(() => parseLLMOutput(`[thought]\ncontent = "bad"\n\n[finish]`)).toThrow(
      /deprecated \[thought\] section: use model-native thinking instead/i,
    );
  });

  test("无 thought 时仍能解析 program 与 finish", () => {
    const parsed = parseLLMOutput(`[program]\ncode = """\nprint(1)\n"""\n\n[finish]`);

    expect(parsed.programs).toHaveLength(1);
    expect(parsed.programs[0]!.code.trim()).toBe("print(1)");
    expect(parsed.directives.finish).toBe(true);
  });
});

describe("parseLLMOutput — [talk/target] 段落", () => {
  test("解析单个 talk 段落", () => {
    const output = `我需要回复用户。

[talk/user]
你好！有什么我能帮你的？
[/talk]

[wait]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.isStructured).toBe(true);
    expect(parsed.thought).toBe("我需要回复用户。");
    expect(parsed.talks).toHaveLength(1);
    expect(parsed.talks[0]!.target).toBe("user");
    expect(parsed.talks[0]!.message).toBe("你好！有什么我能帮你的？");
    expect(parsed.programs).toHaveLength(0);
    expect(parsed.directives.wait).toBe(true);
  });

  test("解析多个 talk 段落（发给不同对象）", () => {
    const output = `需要通知两个对象。

[talk/sophia]
请帮我审查这个设计。
[/talk]

[talk/user]
我已经请 sophia 帮忙审查了。
[/talk]

[wait]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.talks).toHaveLength(2);
    expect(parsed.talks[0]!.target).toBe("sophia");
    expect(parsed.talks[0]!.message).toBe("请帮我审查这个设计。");
    expect(parsed.talks[1]!.target).toBe("user");
    expect(parsed.talks[1]!.message).toBe("我已经请 sophia 帮忙审查了。");
  });

  test("talk 和 program 互斥 — program 优先", () => {
    const output = `测试互斥。

[talk/user]
这条消息应该被忽略。
[/talk]

[program]
talk("通过 program 发送", "user");`;

    const parsed = parseLLMOutput(output);
    expect(parsed.programs).toHaveLength(1);
    expect(parsed.talks).toHaveLength(0); /* talk 被忽略 */
  });

  test("talk 和 finish 并存", () => {
    const output = `[talk/user]
任务完成了，结果如下...
[/talk]

[finish]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.talks).toHaveLength(1);
    expect(parsed.talks[0]!.target).toBe("user");
    expect(parsed.directives.finish).toBe(true);
  });

  test("talk 和 thought 并存", () => {
    const output = `用户问了一个问题，我来回答。

[talk/user]
答案是 42。
[/talk]

[wait]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.thought).toBe("用户问了一个问题，我来回答。");
    expect(parsed.talks).toHaveLength(1);
    expect(parsed.talks[0]!.message).toBe("答案是 42。");
    expect(parsed.directives.wait).toBe(true);
  });

  test("talk 段落无 [/talk] 结束标记（流到末尾自动结束）", () => {
    const output = `[talk/user]
这条消息没有结束标记`;

    const parsed = parseLLMOutput(output);
    expect(parsed.talks).toHaveLength(1);
    expect(parsed.talks[0]!.target).toBe("user");
    expect(parsed.talks[0]!.message).toBe("这条消息没有结束标记");
  });

  test("talk 多行消息内容", () => {
    const output = `[talk/sophia]
第一行内容
第二行内容
第三行内容
[/talk]

[wait]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.talks).toHaveLength(1);
    expect(parsed.talks[0]!.message).toBe("第一行内容\n第二行内容\n第三行内容");
  });

  test("空 talk 段落被忽略", () => {
    const output = `[talk/user]
[/talk]

[wait]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.talks).toHaveLength(0);
  });

  test("仅有 talk 段落也触发结构化解析", () => {
    const output = `[talk/user]
你好
[/talk]

[finish]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.isStructured).toBe(true);
    expect(parsed.talks).toHaveLength(1);
  });

  test("legacy 格式不解析 talk", () => {
    const output = `普通文本回复

\`\`\`javascript
talk("hello", "user");
\`\`\`

[finish]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.isStructured).toBe(false);
    expect(parsed.talks).toHaveLength(0);
    expect(parsed.programs).toHaveLength(1);
  });
});

describe("parseLLMOutput — 文本中提及段落标记名", () => {
  test("反引号包裹的标记名不被误拆", () => {
    const output = `上一轮的 \`[program]\` 段落执行失败了，需要确保代码块中只有纯代码。

[program]
print("hello");

[finish]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.isStructured).toBe(true);
    expect(parsed.thought).toContain("`[program]`");
    expect(parsed.programs).toHaveLength(1);
    expect(parsed.programs[0]!.code).toBe('print("hello");');
    expect(parsed.directives.finish).toBe(true);
  });

  test("文本中多次提及标记名不影响解析", () => {
    const output = `我发现 \`[program]\` 段落标记没有被解析器正确识别，需要确保 \`[program]\` 段落中只有纯代码。

[program]
const x = 1 + 2;
print(x);`;

    const parsed = parseLLMOutput(output);
    expect(parsed.thought).toContain("`[program]`");
    expect(parsed.programs).toHaveLength(1);
    expect(parsed.programs[0]!.code).toContain("const x = 1 + 2");
  });
});

describe("parseLLMOutput — [action/toolName] 段落", () => {
  test("解析单个 action", () => {
    const output = `需要编辑文件\n\n[action/editFile]\n{"path": "test.ts", "old": "foo", "new": "bar"}`;
    const parsed = parseLLMOutput(output);
    expect(parsed.isStructured).toBe(true);
    expect(parsed.thought).toBe("需要编辑文件");
    expect(parsed.actions.length).toBe(1);
    expect(parsed.actions[0]!.toolName).toBe("editFile");
    expect(JSON.parse(parsed.actions[0]!.params)).toEqual({ path: "test.ts", old: "foo", new: "bar" });
  });

  test("解析多个 action", () => {
    const output = `[action/readFile]\n{"path": "a.ts"}\n\n[action/readFile]\n{"path": "b.ts"}`;
    const parsed = parseLLMOutput(output);
    expect(parsed.actions.length).toBe(2);
    expect(parsed.actions[0]!.toolName).toBe("readFile");
    expect(parsed.actions[1]!.toolName).toBe("readFile");
  });

  test("action 和 program 互斥，program 优先", () => {
    const output = `[action/readFile]\n{"path": "a.ts"}\n\n[program]\nconsole.log("hi")`;
    const parsed = parseLLMOutput(output);
    expect(parsed.actions.length).toBe(0);
    expect(parsed.programs.length).toBe(1);
  });

  test("action 和空 program 共存时，空 program 被忽略，action 保留", () => {
    const output = `[action/readFile]\n{"path": "a.ts"}\n\n[program]\n   \n`;
    const parsed = parseLLMOutput(output);
    expect(parsed.actions.length).toBe(1);
    expect(parsed.programs.length).toBe(0);
  });

  test("action 和 talk 可以共存", () => {
    const output = `[action/readFile]\n{"path": "a.ts"}\n\n[talk/user]\n结果如下\n[/talk]`;
    const parsed = parseLLMOutput(output);
    expect(parsed.actions.length).toBe(1);
    expect(parsed.talks.length).toBe(1);
  });

  test("action 带 [/action] 结束标记", () => {
    const output = `[action/editFile]\n{"path": "test.ts", "old": "a", "new": "b"}\n[/action]`;
    const parsed = parseLLMOutput(output);
    expect(parsed.actions.length).toBe(1);
    expect(parsed.actions[0]!.toolName).toBe("editFile");
  });

  test("action 无结束标记（流到末尾自动结束）", () => {
    const output = `[action/glob]\n{"pattern": "**/*.ts"}`;
    const parsed = parseLLMOutput(output);
    expect(parsed.actions.length).toBe(1);
    expect(parsed.actions[0]!.toolName).toBe("glob");
    expect(parsed.actions[0]!.params).toBe('{"pattern": "**/*.ts"}');
  });

  test("action 和 thought 并存", () => {
    const output = `我需要读取配置文件。\n\n[action/readFile]\n{"path": "config.ts"}`;
    const parsed = parseLLMOutput(output);
    expect(parsed.thought).toBe("我需要读取配置文件。");
    expect(parsed.actions.length).toBe(1);
  });

  test("空 action 段落被忽略", () => {
    const output = `[action/readFile]\n[/action]\n\n[wait]`;
    const parsed = parseLLMOutput(output);
    expect(parsed.actions.length).toBe(0);
  });

  test("仅有 action 段落也触发结构化解析", () => {
    const output = `[action/readFile]\n{"path": "a.ts"}\n[/action]`;
    const parsed = parseLLMOutput(output);
    expect(parsed.isStructured).toBe(true);
  });

  test("legacy 格式不解析 action", () => {
    const output = `普通文本\n\n\`\`\`javascript\nprint("hello");\n\`\`\`\n\n[finish]`;
    const parsed = parseLLMOutput(output);
    expect(parsed.isStructured).toBe(false);
    expect(parsed.actions.length).toBe(0);
  });
});

describe("parseLLMOutput — 认知栈 API 解析", () => {
  test("解析 [cognize_stack_frame_push] 基本格式", () => {
    const output = `[cognize_stack_frame_push]

[cognize_stack_frame_push.title]
获取文档内容
[/cognize_stack_frame_push.title]

[cognize_stack_frame_push.description]
从飞书知识库获取指定文档的完整内容
[/cognize_stack_frame_push.description]

[/cognize_stack_frame_push]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.isStructured).toBe(true);
    expect(parsed.stackFrameOperations).toHaveLength(1);

    const op = parsed.stackFrameOperations[0]!;
    expect(op.type).toBe("cognize_stack_frame_push");
    expect(op.title).toBe("获取文档内容");
    expect(op.description).toBe("从飞书知识库获取指定文档的完整内容");
  });

  test("解析 [cognize_stack_frame_push] 完整属性", () => {
    const output = `[cognize_stack_frame_push]

[cognize_stack_frame_push.title]
获取文档
[/cognize_stack_frame_push.title]

[cognize_stack_frame_push.traits]
lark-wiki, web-search
[/cognize_stack_frame_push.traits]

[cognize_stack_frame_push.outputs]
docContent, docTitle
[/cognize_stack_frame_push.outputs]

[cognize_stack_frame_push.outputDescription]
文档内容和元数据
[/cognize_stack_frame_push.outputDescription]

[/cognize_stack_frame_push]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.stackFrameOperations).toHaveLength(1);

    const op = parsed.stackFrameOperations[0]!;
    expect(op.type).toBe("cognize_stack_frame_push");
    expect(op.title).toBe("获取文档");
    expect(op.traits).toEqual(["lark-wiki", "web-search"]);
    expect(op.outputs).toEqual(["docContent", "docTitle"]);
    expect(op.outputDescription).toBe("文档内容和元数据");
  });

  test("解析 [cognize_stack_frame_pop] 带 artifacts", () => {
    const output = `[cognize_stack_frame_pop]

[cognize_stack_frame_pop.summary]
成功获取文档内容
[/cognize_stack_frame_pop.summary]

[cognize_stack_frame_pop.artifacts]
{
  "docContent": "文档正文内容...",
  "docTitle": "技术方案设计",
  "author": "张三"
}
[/cognize_stack_frame_pop.artifacts]

[/cognize_stack_frame_pop]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.stackFrameOperations).toHaveLength(1);

    const op = parsed.stackFrameOperations[0]!;
    expect(op.type).toBe("cognize_stack_frame_pop");
    expect(op.summary).toBe("成功获取文档内容");
    expect(op.artifacts).toEqual({
      docContent: "文档正文内容...",
      docTitle: "技术方案设计",
      author: "张三",
    });
  });

  test("解析 [reflect_stack_frame_push]", () => {
    const output = `[reflect_stack_frame_push]

[reflect_stack_frame_push.title]
反思当前执行路径
[/reflect_stack_frame_push.title]

[reflect_stack_frame_push.description]
检查是否有更好的策略可以使用
[/reflect_stack_frame_push.description]

[/reflect_stack_frame_push]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.stackFrameOperations).toHaveLength(1);

    const op = parsed.stackFrameOperations[0]!;
    expect(op.type).toBe("reflect_stack_frame_push");
    expect(op.title).toBe("反思当前执行路径");
    expect(op.description).toBe("检查是否有更好的策略可以使用");
  });

  test("解析 [set_plan]", () => {
    const output = `[set_plan]
重新规划当前任务：
1. 先激活 lark-wiki trait
2. 调用 wiki API 获取文档内容
[/set_plan]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.stackFrameOperations).toHaveLength(1);

    const op = parsed.stackFrameOperations[0]!;
    expect(op.type).toBe("set_plan");
    expect(op.content).toContain("重新规划当前任务");
    expect(op.content).toContain("1. 先激活 lark-wiki trait");
    expect(op.content).toContain("2. 调用 wiki API 获取文档内容");
  });

  test("title 缺失时解析失败", () => {
    const output = `[cognize_stack_frame_push]

[cognize_stack_frame_push.description]
只有 description，没有 title
[/cognize_stack_frame_push.description]

[/cognize_stack_frame_push]`;

    const parsed = parseLLMOutput(output);
    // title 缺失时，整个操作被忽略
    expect(parsed.stackFrameOperations).toHaveLength(0);
  });

  test("artifacts JSON 无效时只忽略该字段", () => {
    const output = `[cognize_stack_frame_pop]

[cognize_stack_frame_pop.summary]
执行完成
[/cognize_stack_frame_pop.summary]

[cognize_stack_frame_pop.artifacts]
这不是有效的 JSON
[/cognize_stack_frame_pop.artifacts]

[/cognize_stack_frame_pop]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.stackFrameOperations).toHaveLength(1);

    const op = parsed.stackFrameOperations[0]!;
    expect(op.type).toBe("cognize_stack_frame_pop");
    expect(op.summary).toBe("执行完成");
    // artifacts 解析失败，但操作仍然被解析，artifacts 为 undefined
    expect(op.artifacts).toBeUndefined();
  });

  test("解析多个栈帧操作", () => {
    const output = `[cognize_stack_frame_push]

[cognize_stack_frame_push.title]
第一个任务
[/cognize_stack_frame_push.title]

[/cognize_stack_frame_push]

[cognize_stack_frame_pop]

[cognize_stack_frame_pop.summary]
第一个任务完成
[/cognize_stack_frame_pop.summary]

[/cognize_stack_frame_pop]

[set_plan]
调整计划
[/set_plan]`;

    const parsed = parseLLMOutput(output);
    expect(parsed.stackFrameOperations).toHaveLength(3);

    expect(parsed.stackFrameOperations[0]!.type).toBe("cognize_stack_frame_push");
    expect(parsed.stackFrameOperations[1]!.type).toBe("cognize_stack_frame_pop");
    expect(parsed.stackFrameOperations[2]!.type).toBe("set_plan");
  });

  test("解析被 ```toml 包裹的 TOML program/shell 输出", () => {
    const output = "```toml\n[program]\nlang = \"shell\"\ncode = \"\"\"\nlark-cli docs +fetch --doc Z6Aqd5I37omXkDxYuVVcoFqsnWy\n\"\"\"\n```";

    const parsed = parseLLMOutput(output);

    expect(parsed.isStructured).toBe(true);
    expect(parsed.programs).toHaveLength(1);
    expect(parsed.programs[0]!.lang).toBe("shell");
    expect(parsed.programs[0]!.code.trim()).toBe("lark-cli docs +fetch --doc Z6Aqd5I37omXkDxYuVVcoFqsnWy");
  });

  test("旧 [program] 段内嵌 TOML code/lang 字段时应提取真实代码", () => {
    const output = `[program]
lang = "shell"
code = """
lark-cli wiki spaces get_node --params '{"token":"UbpdwXweyi86HHkRHCCcLPN4n8c"}'
"""`;

    const parsed = parseLLMOutput(output);

    expect(parsed.isStructured).toBe(true);
    expect(parsed.programs).toHaveLength(1);
    expect(parsed.programs[0]!.lang).toBe("shell");
    expect(parsed.programs[0]!.code.trim()).toBe("lark-cli wiki spaces get_node --params '{\"token\":\"UbpdwXweyi86HHkRHCCcLPN4n8c\"}'");
  });

  test("TOML 输出中的 [finish] 指令应被识别", () => {
    const output = `[program]
code = """
print("done")
"""

[finish]`;

    const parsed = parseLLMOutput(output);

    expect(parsed.isStructured).toBe(true);
    expect(parsed.programs).toHaveLength(1);
    expect(parsed.directives.finish).toBe(true);
  });
});

describe("createLLMOutputStreamParser — TOML 流式输出", () => {
  test("流式输出显式 [thought] 时抛出协议错误", () => {
    const parser = createLLMOutputStreamParser();

    expect(() => parser.push(`[thought]\ncontent = \"bad\"\n`)).toThrow(
      /deprecated \[thought\] section: use model-native thinking instead/i,
    );
  });

  test("按新 TOML 格式流式产出语义事件", () => {
    const parser = createLLMOutputStreamParser();
    const events = [
      ...parser.push(`[talk]\ntarget = "user"\nmessage = """\n你好，`),
      ...parser.push(`这是新的流式输出\n"""\n\n[program]\nlang = "shell"\ncode = """\necho hi\n"""\n\n[cognize_stack_frame_push]\ntitle = "拆解任务"\ntraits = ["lark/wiki", "web/search"]\noutput_description = """\n文档内容与摘要\n"""\n\nset_plan = """\n1. 阅读文档\n2. 输出总结\n"""\n\n[finish]`),
      ...parser.done(),
    ];

    expect(events).toEqual([
      { type: "talk", target: "user", chunk: "你好，这是新的流式输出\n" },
      { type: "talk:end", target: "user" },
      { type: "program", lang: "shell", chunk: "echo hi\n" },
      { type: "program:end" },
      { type: "stack_push", opType: "cognize", attr: "title", chunk: "拆解任务" },
      { type: "stack_push:end", opType: "cognize", attr: "title" },
      { type: "stack_push", opType: "cognize", attr: "traits", chunk: "lark/wiki, web/search" },
      { type: "stack_push:end", opType: "cognize", attr: "traits" },
      { type: "stack_push", opType: "cognize", attr: "output_description", chunk: "文档内容与摘要\n" },
      { type: "stack_push:end", opType: "cognize", attr: "output_description" },
      { type: "set_plan", chunk: "1. 阅读文档\n" },
      { type: "set_plan", chunk: "2. 输出总结\n" },
      { type: "set_plan:end" },
    ]);
  });
});
