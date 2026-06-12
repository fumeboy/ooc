import { test, expect } from "bun:test";
import { serializeXml, xmlElement } from "@ooc/core/_shared/types/xml.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import { readable } from "../readable.js";
import type { MethodExecWindow } from "../../_shared/types.js";

/**
 * 失败响亮回显：LLM 把 say 的 msg 传成了 content（不在 schema.args 里）。
 * readable 必须把未知参数响亮列出 + 报出本 method 接受的参数（必填标注），不静默映射、不静默忽略。
 */
function mkForm(args: Record<string, unknown>): MethodExecWindow {
  const schema: MethodCallSchema = {
    args: {
      msg: { type: "string", required: true, description: "消息正文" },
      wait: { type: "boolean", required: false, description: "等待回复" },
    },
  };
  return {
    id: "method_exec:test",
    class: "method_exec",
    parentWindowId: "t1",
    title: "say",
    status: "open",
    createdAt: 0,
    method: "say",
    description: "say",
    accumulatedArgs: args,
    intentPaths: ["say"],
    loadedKnowledgePaths: [],
    methodKnowledgePaths: [],
    schema,
  } as MethodExecWindow;
}

test("unknown arg (content) loudly echoed; not silently mapped to msg", () => {
  const form = mkForm({ content: "hello" });
  const xml = serializeXml(xmlElement("window", {}, readable({ window: form, thread: {} as any })));
  expect(xml).toContain("unknown_args");
  expect(xml).toContain("content");
  expect(xml).toContain("已忽略");
  // 报出本 method 接受的参数 + 必填标注
  expect(xml).toContain("msg(必填)");
  // 不静默映射：msg 仍是 missing（next_steps 仍要求提供 msg）
  expect(xml).toContain("提供 msg 参数");
});

test("no unknown_args node when all args are known", () => {
  const form = mkForm({ msg: "hello" });
  const xml = serializeXml(xmlElement("window", {}, readable({ window: form, thread: {} as any })));
  expect(xml).not.toContain("unknown_args");
});
