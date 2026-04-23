/**
 * Test Failure Bridge 单元测试
 *
 * 覆盖：
 * - 环境变量开关：默认关 / 设为 1 启用
 * - recipient 选取顺序：显式 > env > supervisor > alan > 第一个
 * - 失败事件被格式化并投递到 talk
 * - talk 抛错不影响后续事件（安全吞）
 */

import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import {
  formatFailuresAsTalkMessage,
  pickRecipient,
  startTestFailureBridge,
} from "../src/world/test-failure-bridge";
import { __emitFailuresForTest, __resetAll } from "../src/test/runner";
import type { TestFailure } from "../src/test/runner";

const SAMPLE: TestFailure[] = [
  {
    name: "my suite > foo",
    file: "tests/foo.test.ts",
    line: 12,
    message: "expected 1 to equal 2",
    raw: "",
  },
];

beforeEach(async () => {
  await __resetAll();
});

afterEach(async () => {
  await __resetAll();
  delete process.env.OOC_TEST_FAILURE_BRIDGE;
  delete process.env.OOC_TEST_FAILURE_RECIPIENT;
});

describe("formatFailuresAsTalkMessage", () => {
  test("含前缀 [test_failure] 与失败摘要", () => {
    const msg = formatFailuresAsTalkMessage(SAMPLE, "/tmp");
    expect(msg.startsWith("[test_failure]")).toBe(true);
    expect(msg).toContain("my suite > foo");
    expect(msg).toContain("tests/foo.test.ts:12");
    expect(msg).toContain("expected 1 to equal 2");
  });

  test("超过 10 条会被截断并提示余量", () => {
    const many: TestFailure[] = Array.from({ length: 15 }, (_, i) => ({
      name: `t${i}`,
      raw: "",
    }));
    const msg = formatFailuresAsTalkMessage(many, "/tmp");
    expect(msg).toContain("另有 5 条未列出");
  });
});

describe("pickRecipient", () => {
  test("显式 recipient 优先", () => {
    const lookup = {
      names: () => ["a", "supervisor"],
      has: (n: string) => ["a", "supervisor"].includes(n),
    };
    expect(pickRecipient(lookup, "a")).toBe("a");
  });

  test("env 次优先", () => {
    process.env.OOC_TEST_FAILURE_RECIPIENT = "bob";
    const lookup = {
      names: () => ["bob", "supervisor"],
      has: (n: string) => ["bob", "supervisor"].includes(n),
    };
    expect(pickRecipient(lookup)).toBe("bob");
  });

  test("supervisor 第三优先", () => {
    const lookup = {
      names: () => ["alan", "supervisor", "other"],
      has: (n: string) => ["alan", "supervisor", "other"].includes(n),
    };
    expect(pickRecipient(lookup)).toBe("supervisor");
  });

  test("alan 第四优先", () => {
    const lookup = {
      names: () => ["alan", "other"],
      has: (n: string) => ["alan", "other"].includes(n),
    };
    expect(pickRecipient(lookup)).toBe("alan");
  });

  test("兜底第一个非 user", () => {
    const lookup = {
      names: () => ["user", "foo"],
      has: (n: string) => ["user", "foo"].includes(n),
    };
    expect(pickRecipient(lookup)).toBe("foo");
  });

  test("全无匹配返回 null", () => {
    const lookup = {
      names: () => ["user"],
      has: (n: string) => n === "user",
    };
    expect(pickRecipient(lookup)).toBe(null);
  });
});

describe("startTestFailureBridge", () => {
  test("默认关（enableFlag 不是 1 时不订阅）", async () => {
    let delivered = 0;
    const off = startTestFailureBridge({
      lookup: { names: () => ["supervisor"], has: (n) => n === "supervisor" },
      talk: async () => {
        delivered++;
      },
    });
    __emitFailuresForTest(SAMPLE, "/tmp");
    await new Promise((r) => setTimeout(r, 10));
    expect(delivered).toBe(0);
    off();
  });

  test("enableFlag=1 时订阅并投递", async () => {
    const calls: Array<{ recipient: string; message: string }> = [];
    const off = startTestFailureBridge({
      lookup: { names: () => ["supervisor"], has: (n) => n === "supervisor" },
      talk: async (recipient, message) => {
        calls.push({ recipient, message });
      },
      config: { enableFlag: "1" },
    });
    __emitFailuresForTest(SAMPLE, "/tmp/r");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(1);
    expect(calls[0]!.recipient).toBe("supervisor");
    expect(calls[0]!.message).toContain("[test_failure]");
    off();
  });

  test("talk 抛错不冒出（被安静吞）", async () => {
    const off = startTestFailureBridge({
      lookup: { names: () => ["supervisor"], has: (n) => n === "supervisor" },
      talk: async () => {
        throw new Error("boom");
      },
      config: { enableFlag: "1" },
    });
    __emitFailuresForTest(SAMPLE, "/tmp");
    /* 不应抛；等 microtask 走完 */
    await new Promise((r) => setTimeout(r, 20));
    off();
  });

  test("无可用收件人时只日志不投递", async () => {
    let delivered = 0;
    const off = startTestFailureBridge({
      lookup: { names: () => ["user"], has: (n) => n === "user" },
      talk: async () => {
        delivered++;
      },
      config: { enableFlag: "1" },
    });
    __emitFailuresForTest(SAMPLE, "/tmp");
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered).toBe(0);
    off();
  });

  test("空失败列表不投递", async () => {
    let delivered = 0;
    const off = startTestFailureBridge({
      lookup: { names: () => ["supervisor"], has: (n) => n === "supervisor" },
      talk: async () => {
        delivered++;
      },
      config: { enableFlag: "1" },
    });
    __emitFailuresForTest([], "/tmp");
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered).toBe(0);
    off();
  });
});
