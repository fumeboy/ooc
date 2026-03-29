/**
 * http_client library trait 测试
 *
 * 使用本地 Bun 服务器模拟 HTTP 端点，不依赖外部网络。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { httpGet, httpPost, httpRequest } from "../../library/traits/http_client/index";

/** 测试用本地服务器端口 */
const PORT = 19876;

/** 模拟上下文 */
const mockCtx = { rootDir: "/tmp" } as any;

let server: any;

beforeAll(() => {
  server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);

      // GET 端点
      if (url.pathname === "/get") {
        return new Response(JSON.stringify({ method: "GET", ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // POST 端点：回显请求体
      if (url.pathname === "/post") {
        return req.text().then((body) =>
          new Response(JSON.stringify({ method: "POST", body }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      // 慢速端点：用于测试超时
      if (url.pathname === "/slow") {
        return new Promise((resolve) =>
          setTimeout(() => resolve(new Response("slow")), 5000),
        );
      }

      // 大响应端点：用于测试截断
      if (url.pathname === "/large") {
        const largeBody = "x".repeat(60000);
        return new Response(largeBody);
      }

      // 默认 404
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server?.stop();
});

describe("http_client", () => {
  test("httpGet 返回状态码和 body", async () => {
    const result = await httpGet(mockCtx, `http://localhost:${PORT}/get`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe(200);
      expect(result.data.body).toContain("GET");
    }
  });

  test("httpPost 发送 JSON body", async () => {
    const result = await httpPost(mockCtx, `http://localhost:${PORT}/post`, { key: "value" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe(200);
      expect(result.data.body).toContain("value");
    }
  });

  test("httpPost 发送字符串 body", async () => {
    const result = await httpPost(mockCtx, `http://localhost:${PORT}/post`, "raw text" as any);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body).toContain("raw text");
    }
  });

  test("超时返回错误", async () => {
    const result = await httpGet(mockCtx, `http://localhost:${PORT}/slow`, { timeout: 500 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("超时");
    }
  });

  test("404 返回状态码", async () => {
    const result = await httpGet(mockCtx, `http://localhost:${PORT}/notfound`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe(404);
    }
  });

  test("httpRequest 支持自定义方法和 headers", async () => {
    const result = await httpRequest(mockCtx, "GET", `http://localhost:${PORT}/get`, {
      headers: { "X-Custom": "test" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe(200);
    }
  });

  test("大响应体被截断", async () => {
    const result = await httpGet(mockCtx, `http://localhost:${PORT}/large`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body.length).toBeLessThanOrEqual(50100); // 50000 + 截断提示
      expect(result.data.body).toContain("截断");
    }
  });
});
