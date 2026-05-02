// 规则校验单元测试 —— 当前覆盖 R2（版本号格式）
import { describe, expect, it } from "bun:test"
import { checkR2 } from "../../scripts/lib/rules"
import type { ParsedDoc } from "../../scripts/lib/types"

function makeDoc(filePath: string, exportNames: string[]): ParsedDoc {
  return {
    filePath,
    exports: exportNames.map((name, i) => ({ name, line: i + 1 })),
    imports: [],
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

  it("跳过非 export 模式（如 default re-export）—— 这里仅测 ExportedSymbol 输入", () => {
    expect(checkR2([makeDoc("/a.doc.ts", [])])).toEqual([])
  })
})
