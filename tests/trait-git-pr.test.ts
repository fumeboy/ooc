/**
 * git/pr trait 单元测试
 *
 * 只测输入校验与错误路径——不依赖实际的 `gh` CLI（CI 环境可能没装 gh / 没认证），
 * 成功路径由集成测试验证（E2E 另行）。
 */

import { describe, test, expect } from "bun:test";
import {
  createPr,
  listPrs,
  getPr,
  getPrChecks,
  commentOnPr,
  mergePr,
  llm_methods,
} from "../../library/traits/git/pr/index";

const ctx = { rootDir: "/nonexistent-git-repo-for-test" } as any;

describe("git/pr — 输入校验", () => {
  test("createPr: base / head / title / body 任一缺失应返回 error", async () => {
    expect((await createPr(ctx, { base: "", head: "b", title: "t", body: "b" } as any)).ok).toBe(false);
    expect((await createPr(ctx, { base: "a", head: "", title: "t", body: "b" } as any)).ok).toBe(false);
    expect((await createPr(ctx, { base: "a", head: "b", title: "", body: "b" } as any)).ok).toBe(false);
    expect((await createPr(ctx, { base: "a", head: "b", title: "t", body: null as any } as any)).ok).toBe(false);
  });

  test("getPr: number 非正整数应返回 error", async () => {
    expect((await getPr(ctx, { number: 0 })).ok).toBe(false);
    expect((await getPr(ctx, { number: -1 })).ok).toBe(false);
    expect((await getPr(ctx, { number: 1.5 })).ok).toBe(false);
  });

  test("getPrChecks: number 非正整数应返回 error", async () => {
    expect((await getPrChecks(ctx, { number: 0 })).ok).toBe(false);
  });

  test("commentOnPr: number 或 body 缺失应返回 error", async () => {
    expect((await commentOnPr(ctx, { number: 0, body: "x" })).ok).toBe(false);
    expect((await commentOnPr(ctx, { number: 1, body: "" })).ok).toBe(false);
  });

  test("mergePr: method 非法应返回 error", async () => {
    const r = await mergePr(ctx, { number: 1, method: "force-push" as any });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("squash");
  });

  test("mergePr: number 非正整数应返回 error", async () => {
    const r = await mergePr(ctx, { number: 0, method: "squash" });
    expect(r.ok).toBe(false);
  });
});

describe("git/pr — llm_methods 契约", () => {
  test("应导出所有 6 个 llm_methods", () => {
    const expected = [
      "create_pr",
      "list_prs",
      "get_pr",
      "get_pr_checks",
      "comment_on_pr",
      "merge_pr",
    ];
    for (const name of expected) {
      expect(llm_methods[name]).toBeDefined();
      expect(typeof llm_methods[name]!.fn).toBe("function");
    }
  });

  test("merge_pr 的 method 参数必须标记为 required", () => {
    const methodParam = llm_methods.merge_pr!.params.find(p => p.name === "method");
    expect(methodParam).toBeDefined();
    expect(methodParam!.required).toBe(true);
  });
});

describe("git/pr — listPrs 异常路径", () => {
  test("在不存在的 rootDir 上执行应优雅返回 error（不抛异常）", async () => {
    const r = await listPrs({ rootDir: "/definitely/not/a/repo/abcxyz" } as any);
    /* 应返回 error，而非抛异常；具体 error 文本依赖 gh/git 是否安装，这里只断言 ok=false */
    expect(r.ok).toBe(false);
  });
});
