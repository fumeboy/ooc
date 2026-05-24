/**
 * factor-dev-agents — 验证 3 个因子开发 Agent 的 server/index.ts 加载 + 单条 commands.exec 端到端。
 *
 * - sentry_event_factor / sentry_factor_group: callDynamicRPC 走 fetch mock，验证 RPC URL 拼接 + 错误返回结构;
 * - sentry_factor_dev: 走纯 reasoning command（dispatch_to_event_factor），验证返回的 hint 文案。
 *
 * 设计要点:
 * - 直接对 .ooc-world 中的 stone server/index.ts 跑 loadObjectWindow（不复制不重写），保证测试紧贴真实文件；
 * - fetch 用 monkey-patch 方式 mock，恢复 finally 写在 afterEach；
 * - tests are unit-style，不需要 OOC_* env，always run。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { clearServerLoaderCache, loadObjectWindow } from "../../src/executable/server/loader";
import type { StoneObjectRef } from "../../src/persistable";

const baseDir = resolve(__dirname, "../../.ooc-world");

function ref(objectId: string): StoneObjectRef {
  return { baseDir, objectId, stonesBranch: "main" };
}

const realFetch = globalThis.fetch;
let fetchCalls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  fetchCalls = [];
  clearServerLoaderCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.USER_INFO;
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

describe("sentry_event_factor", () => {
  test("search_event_factors 拼出正确的 RPC URL + 解析 JSON 响应", async () => {
    process.env.USER_INFO = "test-user-info";
    mockFetch(() =>
      new Response(JSON.stringify({ list: [{ code: "f1" }], total: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const win = await loadObjectWindow(ref("sentry_event_factor"));
    expect(win).toBeDefined();
    const cmd = win!.commands!.search_event_factors!;
    const result = (await cmd.exec({ args: { eventId: 42, search: "abc", page: 1, size: 10 } } as never)) as {
      ok: boolean;
      result?: string;
      error?: string;
    };

    expect(result.ok).toBe(true);
    expect(result.result).toContain('"code": "f1"');
    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url).toContain("typ=DynamicRPC");
    expect(call.url).toContain("psm=ecom.governance.openmind");
    expect(call.url).toContain("method=EventFactorList");
    expect(call.url).toContain("user_info=test-user-info");
    const body = JSON.parse((call.init?.body as string) ?? "{}");
    expect(body).toEqual({ eventId: 42, search: "abc", page: 1, size: 10 });
  });

  test("search_event_factors 缺 USER_INFO env 给清晰错误", async () => {
    mockFetch(() => new Response("should-not-reach", { status: 200 }));
    const win = await loadObjectWindow(ref("sentry_event_factor"));
    const cmd = win!.commands!.search_event_factors!;
    const result = (await cmd.exec({ args: { eventId: 1 } } as never)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/USER_INFO/);
    expect(fetchCalls).toHaveLength(0);
  });

  test("search_event_factors 缺 eventId 不发请求", async () => {
    process.env.USER_INFO = "x";
    mockFetch(() => new Response("", { status: 200 }));
    const win = await loadObjectWindow(ref("sentry_event_factor"));
    const cmd = win!.commands!.search_event_factors!;
    const result = (await cmd.exec({ args: {} } as never)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/eventId/);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("sentry_factor_group", () => {
  test("get_factor_group_detail 命中 FactorGroupDetail RPC", async () => {
    process.env.USER_INFO = "u";
    mockFetch(() =>
      new Response(JSON.stringify({ code: "fg_001", name: "差评率" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const win = await loadObjectWindow(ref("sentry_factor_group"));
    expect(win).toBeDefined();
    const cmd = win!.commands!.get_factor_group_detail!;
    const result = (await cmd.exec({ args: { code: "fg_001" } } as never)) as {
      ok: boolean;
      result?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.result).toContain('"code": "fg_001"');
    expect(fetchCalls[0]!.url).toContain("method=FactorGroupDetail");
    expect(JSON.parse(fetchCalls[0]!.init?.body as string)).toEqual({ code: "fg_001" });
  });

  test("RPC HTTP 非 2xx 返回结构化错误", async () => {
    process.env.USER_INFO = "u";
    mockFetch(() => new Response("auth failed", { status: 403 }));
    const win = await loadObjectWindow(ref("sentry_factor_group"));
    const cmd = win!.commands!.search_factor_groups!;
    const result = (await cmd.exec({ args: { query: "x" } } as never)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/403/);
  });
});

describe("sentry_factor_dev", () => {
  test("dispatch_to_event_factor 返回派单 hint 文案", async () => {
    const win = await loadObjectWindow(ref("sentry_factor_dev"));
    expect(win).toBeDefined();
    const cmd = win!.commands!.dispatch_to_event_factor!;
    expect(cmd).toBeDefined();
    const result = (await cmd.exec({
      args: { plan_path: "output/tech_plan.md" },
      self: { setData: async () => {}, getData: async () => ({}) },
    } as never)) as { ok: boolean; result?: string };
    expect(result.ok).toBe(true);
    expect(typeof result.result).toBe("string");
    expect(result.result).toContain("sentry_event_factor");
    expect(result.result).toContain("output/tech_plan.md");
  });

  test("commands 列表完整", async () => {
    const win = await loadObjectWindow(ref("sentry_factor_dev"));
    const names = Object.keys(win?.commands ?? {});
    for (const expected of [
      "start_requirement",
      "analyze_requirement",
      "design_plan",
      "assess_security",
      "dispatch_to_event_factor",
      "dispatch_to_factor_group",
      "update_requirement_state",
      "update_requirement_form",
      "emit_user_link",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
