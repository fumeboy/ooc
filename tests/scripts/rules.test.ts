// 规则校验单元测试 —— 当前覆盖 R2（版本号格式）、parseReviewStamp、R1（评审戳）、R3+R4（孤立文件 + 入口白名单）
import { describe, expect, it } from "bun:test"
import { checkR1, checkR2, checkR3, parseReviewStamp } from "../../scripts/lib/rules"
import type { ImportRecord, ParsedDoc } from "../../scripts/lib/types"

function makeDoc(filePath: string, exportNames: string[]): ParsedDoc {
  return {
    filePath,
    exports: exportNames.map((name, i) => ({ name, line: i + 1 })),
    imports: [],
    isEntry: false,
  }
}

describe("R2 - version format", () => {
  it("合法符号通过", () => {
    const doc = makeDoc("/a.doc.ts", ["线程树_v20260503_1", "scheduler_v20260503_2"])
    expect(checkR2([doc])).toEqual([])
  })

  it("缺 _vYYYYMMDD_N 后缀报错", () => {
    const doc = makeDoc("/a.doc.ts", ["线程树"])
    const v = checkR2([doc])
    expect(v).toHaveLength(1)
    expect(v[0]!.rule).toBe("R2")
    expect(v[0]!.severity).toBe("error")
    expect(v[0]!.message).toContain("线程树")
  })

  it("日期不合法报错", () => {
    expect(checkR2([makeDoc("/a.doc.ts", ["x_v2026053_1"])])).toHaveLength(1)
    expect(checkR2([makeDoc("/a.doc.ts", ["x_v20261301_1"])])).toHaveLength(1) // 月份 13
    expect(checkR2([makeDoc("/a.doc.ts", ["x_v20260532_1"])])).toHaveLength(1) // 日 32
  })

  it("序号必须 ≥1", () => {
    expect(checkR2([makeDoc("/a.doc.ts", ["x_v20260503_0"])])).toHaveLength(1)
  })

  it("空 exports 列表返回空违规", () => {
    expect(checkR2([makeDoc("/a.doc.ts", [])])).toEqual([])
  })
})

describe("parseReviewStamp", () => {
  it("合法戳", () => {
    const block = [
      "// @reviewed 线程树_v20260503_1 by sophia @ 2026-05-03",
      "// 确认说明：新版改为 5 原语 (open/refine/submit/close/wait)，仍然适用",
    ].join("\n")
    const stamp = parseReviewStamp(block)
    expect(stamp).not.toBeNull()
    expect(stamp!.symbolName).toBe("线程树_v20260503_1")
    expect(stamp!.actor).toBe("sophia")
    expect(stamp!.date).toBe("2026-05-03")
    expect(stamp!.rationale).toContain("5 原语")
  })

  it("跨行的确认说明", () => {
    const block = [
      "// @reviewed X_v20260503_1 by alan @ 2026-05-03",
      "// 确认说明：第一行",
      "// 第二行延续",
    ].join("\n")
    const stamp = parseReviewStamp(block)
    expect(stamp!.rationale).toContain("第一行")
    expect(stamp!.rationale).toContain("第二行延续")
  })

  it("缺 @reviewed 行返回 null", () => {
    expect(parseReviewStamp("// 一条普通注释")).toBeNull()
  })

  it("缺确认说明返回 null", () => {
    const block = [
      "// @reviewed X_v20260503_1 by alan @ 2026-05-03",
    ].join("\n")
    expect(parseReviewStamp(block)).toBeNull()
  })

  it("确认说明只有空白返回 null", () => {
    const block = [
      "// @reviewed X_v20260503_1 by alan @ 2026-05-03",
      "// 确认说明：",
    ].join("\n")
    expect(parseReviewStamp(block)).toBeNull()
  })

  it("缺 by 字段返回 null", () => {
    const block = [
      "// @reviewed X_v20260503_1 @ 2026-05-03",
      "// 确认说明：xxx",
    ].join("\n")
    expect(parseReviewStamp(block)).toBeNull()
  })

  it("日期格式错误返回 null", () => {
    const block = [
      "// @reviewed X_v20260503_1 by alan @ 26-5-3",
      "// 确认说明：xxx",
    ].join("\n")
    expect(parseReviewStamp(block)).toBeNull()
  })

  it("多个 @reviewed 行返回 null（多戳不支持）", () => {
    const block = [
      "// @reviewed A_v20260503_1 by sophia @ 2026-05-03",
      "// 确认说明：A 说明",
      "// @reviewed B_v20260503_1 by sophia @ 2026-05-03",
      "// 确认说明：B 说明",
    ].join("\n")
    expect(parseReviewStamp(block)).toBeNull()
  })
})

function makeDocWithImport(filePath: string, imp: ImportRecord): ParsedDoc {
  return { filePath, exports: [], imports: [imp], isEntry: false }
}

describe("R1 - review stamp", () => {
  const validBlock = [
    "// @reviewed 线程树_v20260503_1 by sophia @ 2026-05-03",
    "// 确认说明：新版仍然适用",
  ].join("\n")

  it("type-only import 不需要 review 戳", () => {
    const doc = makeDocWithImport("/a.doc.ts", {
      fromPath: "../engine",
      isTypeOnly: true,
      importedNames: ["runThread"],
      line: 5,
      precedingCommentBlock: null,
    })
    expect(checkR1([doc])).toEqual([])
  })

  it("不带版本号的 import 不需要 review 戳（假设这是一个 fallback 引用普通模块）", () => {
    const doc = makeDocWithImport("/a.doc.ts", {
      fromPath: "../utils",
      isTypeOnly: false,
      importedNames: ["formatDate"],
      line: 5,
      precedingCommentBlock: null,
    })
    expect(checkR1([doc])).toEqual([])
  })

  it("带版本号 import 缺戳报错", () => {
    const doc = makeDocWithImport("/a.doc.ts", {
      fromPath: "./b.doc",
      isTypeOnly: false,
      importedNames: ["线程树_v20260503_1"],
      line: 5,
      precedingCommentBlock: null,
    })
    const v = checkR1([doc])
    expect(v).toHaveLength(1)
    expect(v[0]!.rule).toBe("R1")
    expect(v[0]!.message).toContain("缺少 @reviewed 注释块")
  })

  it("戳的符号名与 import 不一致报错", () => {
    const doc = makeDocWithImport("/a.doc.ts", {
      fromPath: "./b.doc",
      isTypeOnly: false,
      importedNames: ["线程树_v20260503_2"],
      line: 5,
      precedingCommentBlock: validBlock, // 戳里是 _1
    })
    const v = checkR1([doc])
    expect(v).toHaveLength(1)
    expect(v[0]!.message).toContain("不在 import 中")
    expect(v[0]!.message).toContain("线程树_v20260503_1")
    expect(v[0]!.message).toContain("线程树_v20260503_2")
  })

  it("合法戳通过", () => {
    const doc = makeDocWithImport("/a.doc.ts", {
      fromPath: "./b.doc",
      isTypeOnly: false,
      importedNames: ["线程树_v20260503_1"],
      line: 5,
      precedingCommentBlock: validBlock,
    })
    expect(checkR1([doc])).toEqual([])
  })

  it("一条 import 多个版本号符号 —— 戳必须覆盖所有", () => {
    const block = [
      "// @reviewed 线程树_v20260503_1 by sophia @ 2026-05-03",
      "// 确认说明：one",
    ].join("\n")
    const doc = makeDocWithImport("/a.doc.ts", {
      fromPath: "./b.doc",
      isTypeOnly: false,
      importedNames: ["线程树_v20260503_1", "调度_v20260503_1"],
      line: 5,
      precedingCommentBlock: block,
    })
    const v = checkR1([doc])
    expect(v).toHaveLength(1) // 调度_v20260503_1 没被戳覆盖
    expect(v[0]!.message).toContain("未覆盖")
    expect(v[0]!.message).toContain("调度_v20260503_1")
  })

  it("注释块格式不合法报错", () => {
    const doc = makeDocWithImport("/a.doc.ts", {
      fromPath: "./b.doc",
      isTypeOnly: false,
      importedNames: ["线程树_v20260503_1"],
      line: 5,
      precedingCommentBlock: "// 一条悬空注释",
    })
    const v = checkR1([doc])
    expect(v).toHaveLength(1)
    expect(v[0]!.message).toMatch(/格式不合法|缺少|@reviewed/)
  })
})

function makeFullDoc(filePath: string, opts: { exports?: string[]; imports?: ImportRecord[]; isEntry?: boolean } = {}): ParsedDoc {
  return {
    filePath,
    exports: (opts.exports ?? []).map((name, i) => ({ name, line: i + 1 })),
    imports: opts.imports ?? [],
    isEntry: opts.isEntry ?? false,
  }
}

describe("R3 - orphan files (with R4 entry whitelist)", () => {
  it("被其他文件 import 的不是孤立", () => {
    const a: ParsedDoc = makeFullDoc("/docs/a.doc.ts", { exports: ["X_v20260503_1"] })
    const b: ParsedDoc = makeFullDoc("/docs/b.doc.ts", {
      imports: [{
        fromPath: "./a.doc",
        isTypeOnly: false,
        importedNames: ["X_v20260503_1"],
        line: 1,
        precedingCommentBlock: null,
      }],
    })
    const v = checkR3([a, b])
    expect(v.find((x) => x.filePath === "/docs/a.doc.ts")).toBeUndefined()
  })

  it("无人 import 的报 warning", () => {
    const a: ParsedDoc = makeFullDoc("/docs/a.doc.ts", { exports: ["X_v20260503_1"] })
    const v = checkR3([a])
    expect(v).toHaveLength(1)
    expect(v[0]!.rule).toBe("R3")
    expect(v[0]!.severity).toBe("warning")
  })

  it("@docs-entry 文件即使无人 import 也不报", () => {
    const a: ParsedDoc = makeFullDoc("/docs/meta.doc.ts", { exports: ["meta_v20260503_1"], isEntry: true })
    expect(checkR3([a])).toEqual([])
  })
})
