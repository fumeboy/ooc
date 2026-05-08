import { describe, expect, it } from "bun:test";
import { createLlmClient } from "../client.ts";

// 真实链路测试默认不参与普通单测，只在显式设置开关时执行。
const shouldRunRealTest = process.env.RUN_REAL_OPENAI_TEST === "1";

describe.skipIf(!shouldRunRealTest)("real openai integration", () => {
  it("使用 .env 中的真实配置完成一次非流式请求", async () => {
    // 这条测试只验证真实链路能通，不追求复杂断言。
    process.env.OOC_PROVIDER = "openai";

    const client = createLlmClient();
    const result = await client.generate({
      messages: [
        {
          role: "system",
          content: "你是一个简洁的测试助手。"
        },
        {
          role: "user",
          content: "请只返回 OK 两个字母。"
        }
      ],
      temperature: 0
    });

    expect(result.provider).toBe("openai");
    expect(result.text.length).toBeGreaterThan(0);
  });
});
