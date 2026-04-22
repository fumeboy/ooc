/**
 * TestRunner 单元测试
 *
 * 覆盖纯函数：parseSummary / parseFailures / parseCoverage / summarizeCoverage
 * 以及 subscribeFailures / listWatchIds 的基础 API。
 *
 * 不跑真 bun test 子进程（避免嵌套递归 + 慢），只测解析逻辑。
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  parseSummary,
  parseFailures,
  parseCoverage,
  summarizeCoverage,
  subscribeFailures,
  listWatchIds,
  __resetAll,
} from "../src/test/runner";

beforeEach(async () => {
  await __resetAll();
});

describe("parseSummary", () => {
  test("标准 bun test 输出", () => {
    const raw = `
 606 pass
 6 skip
 0 fail
 1624 expect() calls
Ran 612 tests across 59 files. [2.08s]
`;
    const s = parseSummary(raw);
    expect(s.pass).toBe(606);
    expect(s.fail).toBe(0);
    expect(s.skip).toBe(6);
  });

  test("有失败的输出", () => {
    const raw = `
 10 pass
 0 skip
 3 fail
`;
    const s = parseSummary(raw);
    expect(s.fail).toBe(3);
    expect(s.pass).toBe(10);
  });

  test("空输出返回全 0", () => {
    const s = parseSummary("");
    expect(s.pass).toBe(0);
    expect(s.fail).toBe(0);
    expect(s.skip).toBe(0);
  });
});

describe("parseFailures", () => {
  test("提取单个失败", () => {
    const raw = `
tests/foo.test.ts:
42 |     expect(x).toBe(1);
                   ^
error: expect(received).toBe(expected)

    at <anonymous> (tests/foo.test.ts:42:17)
(fail) foo > bar [0.5ms]

 1 pass
 1 fail
`;
    const fails = parseFailures(raw);
    expect(fails.length).toBe(1);
    expect(fails[0]!.name).toBe("foo > bar");
    expect(fails[0]!.file).toBe("tests/foo.test.ts");
    expect(fails[0]!.line).toBe(42);
    expect(fails[0]!.message).toContain("expect(received)");
  });

  test("提取多个失败", () => {
    const raw = `
(fail) suite1 > test1 [0.1ms]
(fail) suite2 > test2 [0.2ms]
(pass) suite3 > test3
`;
    const fails = parseFailures(raw);
    expect(fails.length).toBe(2);
    expect(fails[0]!.name).toBe("suite1 > test1");
    expect(fails[1]!.name).toBe("suite2 > test2");
  });

  test("无失败返回空数组", () => {
    const raw = `
(pass) all > good
 10 pass
 0 fail
`;
    const fails = parseFailures(raw);
    expect(fails).toEqual([]);
  });

  test("失败名含中文", () => {
    const raw = `(fail) 编辑计划 > 原子应用 [1.23ms]\n`;
    const fails = parseFailures(raw);
    expect(fails.length).toBe(1);
    expect(fails[0]!.name).toBe("编辑计划 > 原子应用");
  });
});

describe("parseCoverage", () => {
  test("从表格提取总覆盖率", () => {
    const raw = `
------------|---------|---------|
File        | % Funcs | % Lines |
------------|---------|---------|
All files   |   75.25 |   80.50 |
src/foo.ts  |   90.00 |   95.00 |
------------|---------|---------|
`;
    const pct = parseCoverage(raw);
    expect(pct).toBe(75.25);
  });

  test("无 coverage 输出返回 undefined", () => {
    const raw = "some unrelated text";
    expect(parseCoverage(raw)).toBeUndefined();
  });
});

describe("summarizeCoverage", () => {
  test("截取表格前 20 行", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `file${i}.ts | 90 | 95`).join("\n");
    const raw = `
-------|-------|-------
${rows}
-------|-------|-------
`;
    const out = summarizeCoverage(raw);
    expect(out.split("\n").length).toBeLessThanOrEqual(20);
    expect(out).toContain("file0.ts");
  });

  test("无表格返回空串", () => {
    expect(summarizeCoverage("random text")).toBe("");
  });
});

describe("subscribeFailures", () => {
  test("注册 + 卸载", () => {
    let called = 0;
    const off = subscribeFailures(() => {
      called++;
    });
    // 无手动触发，called 应为 0
    expect(called).toBe(0);
    off();
    // 再次卸载不应抛错
    off();
    expect(called).toBe(0);
  });
});

describe("listWatchIds", () => {
  test("初始无 watch", () => {
    expect(listWatchIds()).toEqual([]);
  });
});
