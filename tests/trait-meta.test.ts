/**
 * Trait 元编程测试
 *
 * 覆盖 TSDoc 解析、createTrait/readTrait/editTrait/listTraits API
 */

import { describe, test, expect } from "bun:test";
import { parseTSDoc } from "../src/extendable/trait/index.js";

describe("parseTSDoc", () => {
  test("解析单个函数的描述和参数", () => {
    const source = `
/**
 * 搜索网页信息
 * @param query - 搜索关键词
 * @param limit - 返回结果数量
 */
export async function search(ctx, query: string, limit: number = 10) {
  ctx.print("搜索: " + query);
}
`;
    const result = parseTSDoc(source);
    expect(result.size).toBe(1);

    const info = result.get("search")!;
    expect(info.description).toBe("搜索网页信息");
    expect(info.params).toHaveLength(2);
    expect(info.params[0]!.name).toBe("query");
    expect(info.params[0]!.type).toBe("string");
    expect(info.params[0]!.description).toBe("搜索关键词");
    expect(info.params[0]!.required).toBe(true);
    expect(info.params[1]!.name).toBe("limit");
    expect(info.params[1]!.type).toBe("number");
    expect(info.params[1]!.description).toBe("返回结果数量");
    expect(info.params[1]!.required).toBe(false);
  });

  test("解析多个函数", () => {
    const source = `
/**
 * 获取最新新闻
 */
export async function getNews(ctx) {
  ctx.print("新闻...");
}

/**
 * 保存笔记
 * @param title - 笔记标题
 * @param content - 笔记内容
 */
export function saveNote(ctx, title: string, content: string) {
  ctx.setData("note_" + title, content);
}
`;
    const result = parseTSDoc(source);
    expect(result.size).toBe(2);

    const news = result.get("getNews")!;
    expect(news.description).toBe("获取最新新闻");
    expect(news.params).toHaveLength(0);

    const note = result.get("saveNote")!;
    expect(note.description).toBe("保存笔记");
    expect(note.params).toHaveLength(2);
    expect(note.params[0]!.name).toBe("title");
    expect(note.params[1]!.name).toBe("content");
  });

  test("无 TSDoc 注释的函数不被解析", () => {
    const source = `
export function helper(ctx) {
  return 42;
}
`;
    const result = parseTSDoc(source);
    expect(result.size).toBe(0);
  });

  test("无类型注解的参数默认为 unknown", () => {
    const source = `
/**
 * 简单方法
 * @param data - 数据
 */
export async function process(ctx, data) {
  ctx.print(data);
}
`;
    const result = parseTSDoc(source);
    const info = result.get("process")!;
    expect(info.params).toHaveLength(1);
    expect(info.params[0]!.name).toBe("data");
    expect(info.params[0]!.type).toBe("unknown");
    expect(info.params[0]!.required).toBe(true);
  });

  test("多行描述合并为一行", () => {
    const source = `
/**
 * 这是一个很长的描述
 * 需要多行来说明
 * @param x - 参数
 */
export function foo(ctx, x: string) {}
`;
    const result = parseTSDoc(source);
    const info = result.get("foo")!;
    expect(info.description).toBe("这是一个很长的描述 需要多行来说明");
  });
});
