// docs:check 报告格式化器
// 把 Violation 列表整理成人类可读的文本，并决定进程退出码。
// 退出码规则：有任何 error 退出 1，否则退出 0（warning 不阻塞）。

import type { Violation } from "./types"

export interface Report {
  text: string
  exitCode: number
}

// 按 rule 分组、按 severity 分类输出
export function formatReport(violations: Violation[]): Report {
  if (violations.length === 0) {
    return { text: "docs:check OK\n", exitCode: 0 }
  }

  const lines: string[] = ["docs:check report", "================="]
  const errors = violations.filter((v) => v.severity === "error")
  const warnings = violations.filter((v) => v.severity === "warning")

  const byRule = new Map<string, Violation[]>()
  for (const v of violations) {
    const arr = byRule.get(v.rule) ?? []
    arr.push(v)
    byRule.set(v.rule, arr)
  }

  for (const rule of ["R1", "R2", "R3", "R4"] as const) {
    const arr = byRule.get(rule)
    if (!arr || arr.length === 0) continue
    const sevTag = arr[0]!.severity === "error" ? "✗" : "⚠"
    lines.push("")
    lines.push(`${sevTag} ${rule} ${arr[0]!.severity}s: ${arr.length}`)
    for (const v of arr) {
      const loc = v.line === null ? v.filePath : `${v.filePath}:${v.line}`
      lines.push(`  ${loc}`)
      lines.push(`    ${v.message}`)
    }
  }

  lines.push("")
  lines.push(`Summary: ${errors.length} errors, ${warnings.length} warnings`)
  return { text: lines.join("\n") + "\n", exitCode: errors.length > 0 ? 1 : 0 }
}
