import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as openAiModule from "../providers/openai.ts";

afterEach(() => {
  mock.restore();
});

describe("openai provider", () => {
  it("通过官方 OpenAI SDK 调用 responses.create", async () => {
    const responsesCreate = mock(async () => ({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "sdk ok" }]
        }
      ]
    }));
    const createClient = spyOn(openAiModule, "createOpenAiClient").mockReturnValue({
      responses: {
        create: responsesCreate
      }
    } as never);

    const result = await openAiModule.generateWithOpenAi(
      {
        provider: "openai",
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        model: "gpt-test"
      },
      { input: [{ type: "message", role: "user", content: "hi" }] }
    );

    expect(createClient).toHaveBeenCalled();
    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-test"
      })
    );
    expect(result.text).toBe("sdk ok");
  });

  it("通过 Responses API 解析 message 与 function_call items", async () => {
    spyOn(openAiModule, "createOpenAiClient").mockReturnValue({
      responses: {
        create: mock(async () => ({
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "开始执行" }]
            },
            {
              type: "function_call",
              call_id: "call_1",
              name: "exec",
              arguments: "{\"method\":\"plan\"}"
            }
          ]
        }))
      }
    } as never);

    const result = await openAiModule.generateWithOpenAi(
      {
        provider: "openai",
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        model: "gpt-test"
      },
      {
        input: [{ type: "message", role: "user", content: "hi" }],
        tools: [
          {
            name: "exec",
            description: "提交命令",
            inputSchema: {
              type: "object",
              properties: {
                method: { type: "string" }
              },
              required: ["method"]
            }
          }
        ]
      }
    );

    expect(result.text).toBe("开始执行");
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: "exec",
        arguments: { method: "plan" }
      }
    ]);
    expect(result.outputItems).toEqual([
      {
        type: "message",
        role: "assistant",
        content: "开始执行"
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "exec",
        arguments: { method: "plan" }
      }
    ]);
  });

  it("解析非流式文本结果", async () => {
    spyOn(openAiModule, "createOpenAiClient").mockReturnValue({
      responses: {
        create: mock(async () => ({
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "hello from openai" }]
            }
          ]
        }))
      }
    } as never);

    const result = await openAiModule.generateWithOpenAi(
      {
        provider: "openai",
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        model: "gpt-test"
      },
      { input: [{ type: "message", role: "user", content: "hi" }] }
    );

    expect(result.text).toBe("hello from openai");
    expect(result.outputItems).toEqual([
      {
        type: "message",
        role: "assistant",
        content: "hello from openai"
      }
    ]);
  });

  it("非 2xx 状态码时抛错", async () => {
    spyOn(openAiModule, "createOpenAiClient").mockReturnValue({
      responses: {
        create: mock(async () => {
          const error = new Error("bad request") as Error & { status?: number };
          error.status = 400;
          throw error;
        })
      }
    } as never);

    expect(
      openAiModule.generateWithOpenAi(
        {
          provider: "openai",
          apiKey: "test-key",
          baseUrl: "https://example.com/v1",
          model: "gpt-test"
        },
        { input: [{ type: "message", role: "user", content: "hi" }] }
      )
    ).rejects.toThrow("OpenAI 请求失败");
  });

  it("非 2xx 状态码时保留 OpenAI 兼容服务返回的详细错误信息", async () => {
    spyOn(openAiModule, "createOpenAiClient").mockReturnValue({
      responses: {
        create: mock(async () => {
          const error = new Error("400 Bad Request") as Error & {
            status?: number;
            error?: { message?: string; code?: string; param?: string };
          };
          error.status = 400;
          error.error = {
            message: "Invalid schema for function 'open': array schema missing items.",
            code: "-4003",
            param: "tools[0].parameters"
          };
          throw error;
        })
      }
    } as never);

    expect(
      openAiModule.generateWithOpenAi(
        {
          provider: "openai",
          apiKey: "test-key",
          baseUrl: "https://example.com/v1",
          model: "gpt-test"
        },
        { input: [{ type: "message", role: "user", content: "hi" }] }
      )
    ).rejects.toThrow("OpenAI 请求失败: 400 - Invalid schema for function 'open': array schema missing items. (code=-4003, param=tools[0].parameters)");
  });
});
