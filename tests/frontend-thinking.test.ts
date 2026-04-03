import { describe, expect, test } from "bun:test";
import type { SSEEvent } from "../web/src/api/types";

describe("frontend thinking stream semantics", () => {
  test("stream:thought 事件类型继续存在并承载 provider thinking chunk", () => {
    const sample: Extract<SSEEvent, { type: "stream:thought" }> = {
      type: "stream:thought",
      objectName: "supervisor",
      taskId: "task_x",
      chunk: "我正在思考下一步怎么做。",
    };

    expect(sample.chunk).toBe("我正在思考下一步怎么做。");
    expect(sample.type).toBe("stream:thought");
  });
});
