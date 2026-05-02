// .doc.ts 规则校验器 —— 当前实现 R2（版本号格式）
// 后续 Task 4/5 会在本文件追加 R1（评审戳）和 R3（依赖）。
import type { ParsedDoc, Violation } from "./types"

// 版本号格式正则：{concept}_v{YYYYMMDD}_{N}
// concept = 至少一个字符（允许中文/字母/数字/下划线）；YYYYMMDD = 8 位数字；N ≥ 1（数字）
// 该常量将被 R1 复用（用于判断"该名字是否是版本化符号"）。
export const VERSION_RE = /^(.+)_v(\d{8})_(\d+)$/

// R2: 每个 export 符号必须符合版本号格式 + 日期段合法 + 序号 ≥ 1
export function checkR2(docs: ParsedDoc[]): Violation[] {
  const out: Violation[] = []
  for (const doc of docs) {
    for (const sym of doc.exports) {
      const m = VERSION_RE.exec(sym.name)
      if (!m) {
        out.push({
          rule: "R2",
          severity: "error",
          filePath: doc.filePath,
          line: sym.line,
          message: `符号 "${sym.name}" 不符合 {concept}_v{YYYYMMDD}_{N} 格式`,
        })
        continue
      }
      const [, , dateStr, nStr] = m
      if (!isValidDate(dateStr!)) {
        out.push({
          rule: "R2",
          severity: "error",
          filePath: doc.filePath,
          line: sym.line,
          message: `符号 "${sym.name}" 日期段 "${dateStr}" 非法`,
        })
        continue
      }
      const n = Number(nStr)
      if (!Number.isInteger(n) || n < 1) {
        out.push({
          rule: "R2",
          severity: "error",
          filePath: doc.filePath,
          line: sym.line,
          message: `符号 "${sym.name}" 序号必须 ≥ 1，实际 "${nStr}"`,
        })
      }
    }
  }
  return out
}

// 内部辅助：校验 8 位日期字符串的基本范围（不做精确闰年/月末校验）
function isValidDate(s: string): boolean {
  if (s.length !== 8) return false
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(4, 6))
  const d = Number(s.slice(6, 8))
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  return true
}
