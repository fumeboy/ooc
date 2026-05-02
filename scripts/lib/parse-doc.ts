// .doc.ts 文件解析器
// 关键设计：使用 TypeScript Compiler API (AST)，避免手写正则
// 这样可以正确处理：中文符号名、模板字符串边界、嵌套注释、import type 语义
import ts from "typescript"
import type { ExportedSymbol, ImportRecord, ParsedDoc } from "./types"

// 解析单个 .doc.ts 文件源码，返回结构化结果
// 入参：filePath（仅用作 SourceFile 名字与返回值携带）、source（文件原文）
// 出参：ParsedDoc，含 exports / imports（imports 含上方紧贴注释块）
export function parseDoc(filePath: string, source: string): ParsedDoc {
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  )

  const exports: ExportedSymbol[] = []
  const imports: ImportRecord[] = []

  for (const stmt of sf.statements) {
    // 形如 `export const X = ...` —— 顶层带 export 修饰的变量声明
    if (
      ts.isVariableStatement(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          exports.push({
            name: decl.name.text,
            line: sf.getLineAndCharacterOfPosition(decl.name.getStart(sf)).line + 1,
          })
        }
      }
      continue
    }

    // import 语句
    if (ts.isImportDeclaration(stmt)) {
      imports.push(extractImport(stmt, sf))
      continue
    }
  }

  return { filePath, exports, imports }
}

// 从单条 import 语句节点中抽出 ImportRecord
function extractImport(stmt: ts.ImportDeclaration, sf: ts.SourceFile): ImportRecord {
  const moduleSpec = stmt.moduleSpecifier
  const fromPath = ts.isStringLiteral(moduleSpec) ? moduleSpec.text : ""
  const isTypeOnly = stmt.importClause?.isTypeOnly ?? false
  const importedNames: string[] = []
  if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
    for (const el of stmt.importClause.namedBindings.elements) {
      importedNames.push(el.name.text)
    }
  }
  const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1
  const precedingCommentBlock = extractPrecedingComments(stmt, sf)
  return { fromPath, isTypeOnly, importedNames, line, precedingCommentBlock }
}

// 提取紧贴在 import 语句上方的连续 // 行注释块（注释之间、最后一条注释与 stmt 之间均无空行）
// 设计：用 ts.getLeadingCommentRanges 拿到所有前导注释；
// 反向遍历，遇到非 // 注释或遇到 \n\n（空行）就截断。
function extractPrecedingComments(stmt: ts.Node, sf: ts.SourceFile): string | null {
  const fullStart = stmt.getFullStart()
  const stmtStart = stmt.getStart(sf)
  const ranges = ts.getLeadingCommentRanges(sf.text, fullStart) ?? []
  if (ranges.length === 0) return null

  // 反向遍历找紧贴 stmt 的连续 // 注释块
  // 紧贴判定：当前注释末尾到下一段（更下方的注释 or stmt）起点之间不能含 \n\n
  const collected: ts.CommentRange[] = []
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!
    if (r.kind !== ts.SyntaxKind.SingleLineCommentTrivia) break
    const between = sf.text.slice(r.end, i === ranges.length - 1 ? stmtStart : ranges[i + 1]!.pos)
    // between 应只含 \n 和空白；不能有 \n\s*\n
    if (/\n\s*\n/.test(between)) break
    collected.unshift(r)
  }
  if (collected.length === 0) return null
  return collected.map((r) => sf.text.slice(r.pos, r.end)).join("\n")
}
