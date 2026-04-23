/**
 * code_index parser 单元测试
 *
 * 覆盖 tree-sitter extractor 对 TS / JS / Python / Go / Rust 的符号提取精度。
 */

import { describe, test, expect } from "bun:test";
import { parseAndExtract, tsLangOf } from "../traits/computable/code_index/parser/extractor";

describe("tree-sitter extractor - TypeScript", () => {
  test("提取 function / class / interface / type / const", async () => {
    const src = [
      "/** 用户获取函数 */",
      "export async function fetchUser(id: string): Promise<User> {",
      "  return { id, name: 'alice' };",
      "}",
      "",
      "export class UserService {",
      "  async get(id: string) { return fetchUser(id); }",
      "}",
      "",
      "export interface User { id: string; name: string; }",
      "export type UserId = string;",
      "export const API_URL = 'https://example.com';",
      "export const handler = async (x: number) => { return x + 1; };",
    ].join("\n");
    const { symbols, callees } = await parseAndExtract(src, "typescript");
    const names = symbols.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain("function:fetchUser");
    expect(names).toContain("class:UserService");
    expect(names).toContain("interface:User");
    expect(names).toContain("type:UserId");
    expect(names).toContain("const:API_URL");
    expect(names).toContain("function:handler"); /* arrow function */
    /* 签名字段 */
    const fn = symbols.find((s) => s.name === "fetchUser")!;
    expect(fn.signature).toContain("fetchUser");
    expect(fn.docstring).toContain("用户获取函数");
    /* callees */
    const userServiceCallees = callees.find((c) => c.symbolKey.startsWith("UserService@"));
    expect(userServiceCallees).toBeDefined();
    expect(userServiceCallees!.callees).toContain("fetchUser");
  });

  test("不误识别 interface 的 method 为 symbol", async () => {
    const src = `
interface Foo {
  bar(x: number): string;
}
`;
    const { symbols } = await parseAndExtract(src, "typescript");
    const ifaceHits = symbols.filter((s) => s.kind === "interface");
    expect(ifaceHits.length).toBe(1);
    expect(ifaceHits[0]!.name).toBe("Foo");
    /* bar 不应作为 function 出现在模块顶层 */
    const funs = symbols.filter((s) => s.name === "bar");
    expect(funs.length).toBe(0);
  });
});

describe("tree-sitter extractor - Python", () => {
  test("提取 function / class / top-level const", async () => {
    const src = [
      "# 工具函数",
      "def greet(name):",
      "    return f'hello {name}'",
      "",
      "class User:",
      "    def say(self):",
      "        return greet('x')",
      "",
      "API_URL = 'http://x'",
    ].join("\n");
    const { symbols, callees } = await parseAndExtract(src, "python");
    const names = symbols.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain("function:greet");
    expect(names).toContain("class:User");
    expect(names).toContain("const:API_URL");
    /* User 类里调用 greet */
    const userCallees = callees.find((c) => c.symbolKey.startsWith("User@"));
    expect(userCallees).toBeDefined();
    expect(userCallees!.callees).toContain("greet");
  });
});

describe("tree-sitter extractor - Go", () => {
  test("提取 func / type / const", async () => {
    const src = `
package main

// 入口函数
func Run() int {
  return helper()
}

func helper() int { return 1 }

type User struct { ID string }

const Max = 100
`;
    const { symbols, callees } = await parseAndExtract(src, "go");
    const names = symbols.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain("function:Run");
    expect(names).toContain("function:helper");
    expect(names).toContain("type:User");
    expect(names).toContain("const:Max");
    const runCallees = callees.find((c) => c.symbolKey.startsWith("Run@"));
    expect(runCallees).toBeDefined();
    expect(runCallees!.callees).toContain("helper");
  });
});

describe("tree-sitter extractor - Rust", () => {
  test("提取 fn / struct / trait / const", async () => {
    const src = `
/// 入口函数
fn main() {
    let u = make_user();
    u.say();
}

fn make_user() -> User { User { id: 1 } }

struct User { id: u32 }

trait Greeter { fn greet(&self); }

const MAX: u32 = 100;
`;
    const { symbols, callees } = await parseAndExtract(src, "rust");
    const names = symbols.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain("function:main");
    expect(names).toContain("function:make_user");
    expect(names).toContain("class:User");
    expect(names).toContain("interface:Greeter");
    expect(names).toContain("const:MAX");
    const mainCallees = callees.find((c) => c.symbolKey.startsWith("main@"));
    expect(mainCallees).toBeDefined();
    expect(mainCallees!.callees).toContain("make_user");
  });
});

describe("tsLangOf", () => {
  test("扩展名映射", () => {
    expect(tsLangOf(".ts")).toBe("typescript");
    expect(tsLangOf(".tsx")).toBe("tsx");
    expect(tsLangOf(".js")).toBe("javascript");
    expect(tsLangOf(".jsx")).toBe("tsx");
    expect(tsLangOf(".py")).toBe("python");
    expect(tsLangOf(".go")).toBe("go");
    expect(tsLangOf(".rs")).toBe("rust");
    expect(tsLangOf(".txt")).toBeNull();
  });
});
