import { describe, expect, it } from "bun:test"
import { formatReport } from "../../scripts/lib/report"
import type { Violation } from "../../scripts/lib/types"

describe("formatReport", () => {
  it("无违规输出 OK", () => {
    const r = formatReport([])
    expect(r.text).toContain("OK")
    expect(r.exitCode).toBe(0)
  })

  it("仅 warning 退出码 0", () => {
    const v: Violation[] = [{
      rule: "R3", severity: "warning",
      filePath: "/docs/orphan.doc.ts", line: null,
      message: "孤立",
    }]
    const r = formatReport(v)
    expect(r.exitCode).toBe(0)
    expect(r.text).toContain("R3")
    expect(r.text).toContain("orphan.doc.ts")
  })

  it("有 error 退出码 1", () => {
    const v: Violation[] = [{
      rule: "R1", severity: "error",
      filePath: "/docs/a.doc.ts", line: 5,
      message: "缺戳",
    }]
    const r = formatReport(v)
    expect(r.exitCode).toBe(1)
  })

  it("按规则分组", () => {
    const v: Violation[] = [
      { rule: "R1", severity: "error", filePath: "/a.doc.ts", line: 1, message: "x" },
      { rule: "R2", severity: "error", filePath: "/b.doc.ts", line: 2, message: "y" },
      { rule: "R1", severity: "error", filePath: "/c.doc.ts", line: 3, message: "z" },
    ]
    const r = formatReport(v)
    // R1 分组应包含 a 和 c；R2 分组应包含 b
    const r1Section = r.text.match(/R1[\s\S]*?(?=R2|Summary)/)?.[0] ?? ""
    expect(r1Section).toContain("a.doc.ts")
    expect(r1Section).toContain("c.doc.ts")
  })
})
