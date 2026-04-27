/**
 * 线程 Debug 记录器测试
 *
 * @ref docs/superpowers/specs/2026-04-11-observability-framework-design.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  writeDebugLoop,
  computeContextStats,
  getExistingLoopCount,
  type WriteDebugLoopParams,
} from "../src/observable/debug/debug.js";

const TMP = join(import.meta.dir, "__tmp_debug__");

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function makeParams(overrides?: Partial<WriteDebugLoopParams>): WriteDebugLoopParams {
  return {
    debugDir: join(TMP, "debug"),
    loopIndex: 1,
    messages: [
      { role: "system", content: "你是 bruce" },
      { role: "user", content: "请帮我分析" },
    ],
    llmOutput: '[thought]\ncontent = "正在分析"',
    source: "llm",
    llmMeta: {
      model: "gpt-4o",
      latencyMs: 3200,
      promptTokens: 4500,
      completionTokens: 800,
      totalTokens: 5300,
    },
    contextStats: {
      totalChars: 18000,
      totalMessageChars: 19500,
      sections: { whoAmI: 500, instructions: 6000, knowledge: 3000, process: 5000 },
    },
    activeTraits: ["kernel/computable", "kernel/talkable"],
    activeSkills: ["commit"],
    parsedDirectives: ["thought"],
    threadId: "th_test",
    objectName: "bruce",
    ...overrides,
  };
}

describe("writeDebugLoop", () => {
  test("生成 input.txt、output.txt、meta.json", () => {
    writeDebugLoop(makeParams());
    const debugDir = join(TMP, "debug");
    expect(existsSync(join(debugDir, "loop_001.input.txt"))).toBe(true);
    expect(existsSync(join(debugDir, "loop_001.output.txt"))).toBe(true);
    expect(existsSync(join(debugDir, "loop_001.meta.json"))).toBe(true);
  });

  test("input.txt 包含 Messages 格式", () => {
    writeDebugLoop(makeParams());
    const content = readFileSync(join(TMP, "debug", "loop_001.input.txt"), "utf-8");
    expect(content).toContain("--- system ---");
    expect(content).toContain("你是 bruce");
    expect(content).toContain("--- user ---");
    expect(content).toContain("请帮我分析");
  });

  test("output.txt 包含 LLM 原始输出", () => {
    writeDebugLoop(makeParams());
    const content = readFileSync(join(TMP, "debug", "loop_001.output.txt"), "utf-8");
    expect(content).toContain('[thought]');
    expect(content).toContain("正在分析");
  });

  test("meta.json 结构正确", () => {
    writeDebugLoop(makeParams());
    const meta = JSON.parse(readFileSync(join(TMP, "debug", "loop_001.meta.json"), "utf-8"));
    expect(meta.loop).toBe(1);
    expect(meta.threadId).toBe("th_test");
    expect(meta.objectName).toBe("bruce");
    expect(meta.source).toBe("llm");
    expect(meta.llm.model).toBe("gpt-4o");
    expect(meta.llm.latencyMs).toBe(3200);
    expect(meta.llm.promptTokens).toBe(4500);
    expect(meta.activeTraits).toContain("kernel/computable");
    expect(meta.activeSkills).toContain("commit");
    expect(meta.parsedDirectives).toContain("thought");
    expect(meta.context.totalChars).toBe(18000);
    expect(meta.context.totalMessageChars).toBe(19500);
  });

  test("thinking.txt 仅在有内容时生成", () => {
    writeDebugLoop(makeParams());
    expect(existsSync(join(TMP, "debug", "loop_001.thinking.txt"))).toBe(false);

    writeDebugLoop(makeParams({ loopIndex: 2, thinkingContent: "我在思考..." }));
    expect(existsSync(join(TMP, "debug", "loop_002.thinking.txt"))).toBe(true);
    const content = readFileSync(join(TMP, "debug", "loop_002.thinking.txt"), "utf-8");
    expect(content).toBe("我在思考...");
  });

  test("loop 编号三位数补零", () => {
    writeDebugLoop(makeParams({ loopIndex: 1 }));
    writeDebugLoop(makeParams({ loopIndex: 12 }));
    writeDebugLoop(makeParams({ loopIndex: 123 }));
    const debugDir = join(TMP, "debug");
    expect(existsSync(join(debugDir, "loop_001.meta.json"))).toBe(true);
    expect(existsSync(join(debugDir, "loop_012.meta.json"))).toBe(true);
    expect(existsSync(join(debugDir, "loop_123.meta.json"))).toBe(true);
  });

  test("source=cached 场景", () => {
    writeDebugLoop(makeParams({
      source: "cached",
      llmMeta: { model: "gpt-4o", latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }));
    const meta = JSON.parse(readFileSync(join(TMP, "debug", "loop_001.meta.json"), "utf-8"));
    expect(meta.source).toBe("cached");
    expect(meta.llm.latencyMs).toBe(0);
  });
});

describe("computeContextStats", () => {
  test("计算各区域字符数", () => {
    const ctx = {
      whoAmI: "我是 bruce",
      instructions: [{ content: "指令1" }, { content: "指令2" }],
      knowledge: [{ content: "知识窗口" }],
      process: "执行历史...",
      plan: "计划",
      parentExpectation: "期望",
      childrenSummary: "子节点",
      ancestorSummary: "祖先",
      siblingSummary: "",
      inbox: [{ id: "1", content: "msg" }],
      todos: [],
      directory: [{ name: "obj1" }],
      locals: { key: "value" },
    };
    const stats = computeContextStats(ctx);
    expect(stats.sections.whoAmI).toBe("我是 bruce".length);
    expect(stats.sections.instructions).toBe("指令1".length + "指令2".length);
    expect(stats.sections.knowledge).toBe("知识窗口".length);
    expect(stats.sections.process).toBe("执行历史...".length);
    expect(stats.sections.siblingSummary).toBe(0);
    expect(stats.totalChars).toBeGreaterThan(0);
    expect(stats.totalChars).toBe(Object.values(stats.sections).reduce((a, b) => a + b, 0));
  });
});

describe("getExistingLoopCount", () => {
  test("空目录返回 0", () => {
    expect(getExistingLoopCount(join(TMP, "nonexistent"))).toBe(0);
  });

  test("统计已有 meta.json 文件数量", () => {
    const debugDir = join(TMP, "debug");
    mkdirSync(debugDir, { recursive: true });
    writeDebugLoop(makeParams({ debugDir, loopIndex: 1 }));
    writeDebugLoop(makeParams({ debugDir, loopIndex: 2 }));
    expect(getExistingLoopCount(debugDir)).toBe(2);
  });
});
