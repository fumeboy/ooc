/**
 * 对象类型（selfKind）自动检测测试（Phase 7）
 *
 * 根据 stoneDir 的路径形态（是否嵌在 flows/<sid>/objects/ 下）判断是 stone 还是 flow_obj，
 * 并在是 flow_obj 时提取 sessionId。
 */

import { describe, test, expect } from "bun:test";
import { detectSelfKind } from "../src/thread/self-kind.js";

describe("detectSelfKind", () => {
  test("stones/<name>/ → stone", () => {
    const r = detectSelfKind("/proj/stones/alice", "/proj/flows");
    expect(r.selfKind).toBe("stone");
    expect(r.sessionId).toBeUndefined();
  });

  test("flows/<sid>/objects/<name>/ → flow_obj + sessionId", () => {
    const r = detectSelfKind("/proj/flows/s_001/objects/tmp_reporter", "/proj/flows");
    expect(r.selfKind).toBe("flow_obj");
    expect(r.sessionId).toBe("s_001");
  });

  test("目录形态不是 flows/<sid>/objects/<name> → 回退 stone", () => {
    const r = detectSelfKind("/proj/flows/s_001", "/proj/flows");
    expect(r.selfKind).toBe("stone");
  });

  test("flowsDir 不匹配（不同根） → stone", () => {
    const r = detectSelfKind("/other/flows/s_001/objects/x", "/proj/flows");
    expect(r.selfKind).toBe("stone");
  });

  test("空 stoneDir → stone 兜底", () => {
    const r = detectSelfKind("", "/proj/flows");
    expect(r.selfKind).toBe("stone");
  });

  test("末尾带斜杠不影响识别", () => {
    const r = detectSelfKind("/proj/flows/s_001/objects/tmp/", "/proj/flows");
    expect(r.selfKind).toBe("flow_obj");
    expect(r.sessionId).toBe("s_001");
  });

  test("中文 sessionId 也被正确提取", () => {
    const r = detectSelfKind("/proj/flows/会话_001/objects/x", "/proj/flows");
    expect(r.selfKind).toBe("flow_obj");
    expect(r.sessionId).toBe("会话_001");
  });
});
