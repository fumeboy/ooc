// .doc.ts 解析器的单元测试
// 验证：export 符号提取、import 提取、紧贴注释块识别
import { describe, expect, it } from "bun:test"
import { parseDoc } from "../../scripts/lib/parse-doc"

describe("parseDoc - exports", () => {
  it("提取单个中文 export 符号", () => {
    const source = [
      "export const 线程树_v20260503_1 = `markdown body`",
    ].join("\n")
    const result = parseDoc("/fake/a.doc.ts", source)
    expect(result.exports).toHaveLength(1)
    expect(result.exports[0]!.name).toBe("线程树_v20260503_1")
    expect(result.exports[0]!.line).toBe(1)
  })

  it("提取多个 export", () => {
    const source = [
      "export const 线程树_v20260503_1 = `a`",
      "export const 线程树_调度_v20260503_1 = `b`",
    ].join("\n")
    const result = parseDoc("/fake/a.doc.ts", source)
    expect(result.exports.map((e) => e.name)).toEqual([
      "线程树_v20260503_1",
      "线程树_调度_v20260503_1",
    ])
  })
})

describe("parseDoc - imports", () => {
  it("提取普通 import 与符号", () => {
    const source = [
      'import { 线程树_v20260503_1 } from "../认知/thread-tree.doc"',
      "export const 协作模型_v20260503_1 = `body`",
    ].join("\n")
    const result = parseDoc("/fake/a.doc.ts", source)
    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]!.fromPath).toBe("../认知/thread-tree.doc")
    expect(result.imports[0]!.importedNames).toEqual(["线程树_v20260503_1"])
    expect(result.imports[0]!.isTypeOnly).toBe(false)
    expect(result.imports[0]!.line).toBe(1)
  })

  it("识别 import type", () => {
    const source = 'import type { runThread } from "../../kernel/src/thinkable/engine"\n'
    const result = parseDoc("/fake/a.doc.ts", source)
    expect(result.imports[0]!.isTypeOnly).toBe(true)
  })

  it("提取紧贴上方的 // 注释块（无空行）", () => {
    const source = [
      "// @reviewed 线程树_v20260503_1 by sophia @ 2026-05-03",
      "// 确认说明：新版改为 5 原语",
      'import { 线程树_v20260503_1 } from "./thread-tree.doc"',
    ].join("\n")
    const result = parseDoc("/fake/a.doc.ts", source)
    const block = result.imports[0]!.precedingCommentBlock
    expect(block).not.toBeNull()
    expect(block).toContain("@reviewed 线程树_v20260503_1")
    expect(block).toContain("确认说明：新版改为 5 原语")
  })

  it("空行隔开的注释块不算前置", () => {
    const source = [
      "// 一条悬空注释",
      "",
      'import { X } from "./y.doc"',
    ].join("\n")
    const result = parseDoc("/fake/a.doc.ts", source)
    expect(result.imports[0]!.precedingCommentBlock).toBeNull()
  })
})

describe("parseDoc - entry marker", () => {
  it("// @docs-entry 在前几行被识别", () => {
    const source = "// @docs-entry\nexport const X_v20260503_1 = `body`"
    expect(parseDoc("/a.doc.ts", source).isEntry).toBe(true)
  })

  it("没有 marker 默认 false", () => {
    const source = "export const X_v20260503_1 = `body`"
    expect(parseDoc("/a.doc.ts", source).isEntry).toBe(false)
  })

  it("// @docs-entry 后跟中文注释也被识别", () => {
    const source = "// @docs-entry — 这个文件是 docs 入口\nexport const X_v20260503_1 = `body`"
    expect(parseDoc("/a.doc.ts", source).isEntry).toBe(true)
  })

  it("// @docs-entry-extra 不被识别（避免误命中扩展名）", () => {
    const source = "// @docs-entry-extra\nexport const X_v20260503_1 = `body`"
    expect(parseDoc("/a.doc.ts", source).isEntry).toBe(false)
  })
})
