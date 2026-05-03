// .doc.ts 规则校验器 —— 当前实现 R1（评审戳）+ R2（版本号格式）+ R3（孤立文件）+ R4（入口白名单）
import { dirname, resolve } from "node:path"
import type { ParsedDoc, ReviewStamp, Violation } from "./types"

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

// 第一行格式：// @reviewed {symbol} by {actor} @ {YYYY-MM-DD}
// 后续行格式：// 确认说明：{text}（允许跨多行延续）
const REVIEWED_LINE_RE = /^\/\/\s*@reviewed\s+(\S+)\s+by\s+(\S+)\s+@\s+(\d{4}-\d{2}-\d{2})\s*$/
const RATIONALE_HEAD_RE = /^\/\/\s*确认说明[:：]\s*(.*)$/
const COMMENT_LINE_RE = /^\/\/\s?(.*)$/

// 解析一段紧贴 import 上方的 // 注释块为 ReviewStamp；不合法返回 null
export function parseReviewStamp(block: string): ReviewStamp | null {
  const lines = block.split("\n").map((l) => l.trim())
  if (lines.length < 2) return null

  const head = REVIEWED_LINE_RE.exec(lines[0]!)
  if (!head) return null
  const [, symbolName, actor, date] = head

  // 探测：除首行外不应再出现 @reviewed —— 多戳目前不支持，同一 import 多版本符号必须拆成多个 import
  for (let i = 1; i < lines.length; i++) {
    if (REVIEWED_LINE_RE.test(lines[i]!)) return null
  }

  // 找"确认说明"起始行
  let rationaleStart = -1
  for (let i = 1; i < lines.length; i++) {
    if (RATIONALE_HEAD_RE.test(lines[i]!)) {
      rationaleStart = i
      break
    }
  }
  if (rationaleStart === -1) return null

  // 拼接确认说明（首行 + 后续延续行）
  const parts: string[] = []
  const headMatch = RATIONALE_HEAD_RE.exec(lines[rationaleStart]!)!
  if (headMatch[1]) parts.push(headMatch[1])
  for (let i = rationaleStart + 1; i < lines.length; i++) {
    const m = COMMENT_LINE_RE.exec(lines[i]!)
    if (m) parts.push(m[1] ?? "")
  }
  const rationale = parts.join(" ").trim()
  if (rationale.length === 0) return null

  return { symbolName: symbolName!, actor: actor!, date: date!, rationale }
}

// R1: 每条带版本号符号的 import 上方必须有合法 @reviewed 注释块覆盖所有版本号符号
// 行为：
//   - type-only import 跳过（不需要戳，TS 已校验存在性，且文档 → 源码不参与版本游戏）
//   - 普通 import：对每个 importedName 用 VERSION_RE 判断是否带版本号
//     不带版本号的不要求戳；带版本号的要求戳里的 symbolName 与之一致
//     一条 import 里有多个版本号符号时，每个都需要被一个戳覆盖（多戳暂不支持：同一 import 多版本符号必须拆成多个 import 语句）
//   - 当前实现假定一条 import 只能配一个戳块；多版本号符号要么共用一个戳、要么报错
//     （这是约定：同一 import 多符号通常意味着它们一起升版）
export function checkR1(docs: ParsedDoc[]): Violation[] {
  const out: Violation[] = []
  for (const doc of docs) {
    for (const imp of doc.imports) {
      if (imp.isTypeOnly) continue
      const versioned = imp.importedNames.filter((n) => VERSION_RE.test(n))
      if (versioned.length === 0) continue

      if (imp.precedingCommentBlock === null) {
        out.push({
          rule: "R1",
          severity: "error",
          filePath: doc.filePath,
          line: imp.line,
          message: `import { ${imp.importedNames.join(", ")} } 上方缺少 @reviewed 注释块`,
        })
        continue
      }

      const stamp = parseReviewStamp(imp.precedingCommentBlock)
      if (!stamp) {
        out.push({
          rule: "R1",
          severity: "error",
          filePath: doc.filePath,
          line: imp.line,
          message: `import { ${imp.importedNames.join(", ")} } 上方注释块格式不合法（需含 @reviewed/by/日期/确认说明）`,
        })
        continue
      }

      // 当前一戳一 import 模型：戳的 symbolName 必须出现在 versioned 中
      // 其余未被覆盖的版本号符号报错
      const stampHits = versioned.includes(stamp.symbolName)
      if (!stampHits) {
        // 戳覆盖的符号不在 import 中 —— 真正的不一致
        out.push({
          rule: "R1",
          severity: "error",
          filePath: doc.filePath,
          line: imp.line,
          message: `@reviewed 戳覆盖 "${stamp.symbolName}"，但该符号不在 import 中（实际 import: [${versioned.join(", ")}]）`,
        })
      } else {
        const uncovered = versioned.filter((n) => n !== stamp.symbolName)
        if (uncovered.length > 0) {
          out.push({
            rule: "R1",
            severity: "error",
            filePath: doc.filePath,
            line: imp.line,
            message: `@reviewed 戳覆盖 "${stamp.symbolName}"，未覆盖 [${uncovered.join(", ")}]（一条 import 多个版本符号需拆分成多条 import）`,
          })
        }
      }
    }
  }
  return out
}

// R3: 孤立文件检测（warning）—— 配合 R4 入口白名单
// 算法：
//   1. 把所有 doc.imports 的 fromPath 解析为绝对路径并归到一个 importedSet
//      （fromPath 通常省略后缀，如 "./a.doc"，因此尝试原样、+.ts、+.doc.ts 三种候选都加入集合）
//   2. 遍历 docs，未被 importedSet 命中且 isEntry === false 的发 warning
// R4 落地：isEntry 文件直接 continue，不参与孤立判定（即文件顶部含 // @docs-entry 标记）
export function checkR3(docs: ParsedDoc[]): Violation[] {
  const importedSet = new Set<string>()
  for (const doc of docs) {
    const baseDir = dirname(doc.filePath)
    for (const imp of doc.imports) {
      const candidates = [
        resolve(baseDir, imp.fromPath),
        resolve(baseDir, imp.fromPath + ".ts"),
        resolve(baseDir, imp.fromPath + ".doc.ts"),
      ]
      for (const c of candidates) importedSet.add(c)
    }
  }

  const out: Violation[] = []
  for (const doc of docs) {
    if (doc.isEntry) continue
    if (!importedSet.has(doc.filePath)) {
      out.push({
        rule: "R3",
        severity: "warning",
        filePath: doc.filePath,
        line: null,
        message: "孤立 .doc.ts —— 没有任何文件 import 它（如是入口文档，请在前 5 行加 // @docs-entry）",
      })
    }
  }
  return out
}
