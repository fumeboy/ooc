// 解析后的单个 .doc.ts 文件
export interface ParsedDoc {
  filePath: string                     // 绝对路径
  exports: ExportedSymbol[]
  imports: ImportRecord[]
  isEntry: boolean                     // 含 // @docs-entry 标记的文件（参与 R4 入口白名单）
}

// 一个 export const X = `...`
export interface ExportedSymbol {
  name: string                         // 如 "线程树_v20260503_1"
  line: number                         // 1-based
}

// 一个 import 语句（含上方紧贴的注释块）
export interface ImportRecord {
  fromPath: string                     // 解析后的相对路径字符串（原样）
  isTypeOnly: boolean                  // import type ... 形式（当前不识别 import { type X } 这种 per-element 形式）
  importedNames: string[]              // 大括号里的符号名
  line: number                         // import 语句 1-based 行号
  precedingCommentBlock: string | null // 紧贴上方的连续 // 注释块原文（保留 //），无空行隔开则非 null
}

// review 戳解析结果（从 precedingCommentBlock 提取）
export interface ReviewStamp {
  symbolName: string                   // @reviewed 后的符号名
  actor: string                        // by 后的 actor 名
  date: string                         // YYYY-MM-DD
  rationale: string                    // 确认说明：后的全部文本
}

// 全部规则码，按报告输出顺序排列。新增规则时在此追加，避免 report.ts 漏报。
export const ALL_RULES = ["R1", "R2", "R3", "R4"] as const
export type RuleCode = typeof ALL_RULES[number]

// 一条违规
export interface Violation {
  rule: RuleCode
  severity: "error" | "warning"
  filePath: string
  line: number | null                  // 文件级违规可为 null
  message: string
}
