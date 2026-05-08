import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { createLlmClient } from "../client.ts";

// 真实测试优先读取当前工作区 .env，没有时回退到主仓库根目录 .env。
function loadRealEnv(): void {
  const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separator = trimmed.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator);
      const value = trimmed.slice(separator + 1);
      process.env[key] = value;
    }

    return;
  }
}

// 真实链路测试默认不参与普通单测，只在显式设置开关时执行。
const shouldRunRealTest = process.env.RUN_REAL_OPENAI_TEST === "1";

describe.skipIf(!shouldRunRealTest)("real openai integration", () => {
  it("使用 .env 中的真实配置完成一次非流式请求", async () => {
    // 这条测试只验证真实链路能通，不追求复杂断言。
    loadRealEnv();
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
    expect(result.toolCalls).toEqual([]);
  }, 90000);
});
