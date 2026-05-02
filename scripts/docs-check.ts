#!/usr/bin/env bun
// docs:check —— 检查 docs/ 下 .doc.ts 文件的版本号 review 戳合法性
// 用法（在 user repo 根执行）：bun run --cwd kernel docs:check [docsDir]
//        或 bun kernel/scripts/docs-check.ts [docsDir]

import { Glob } from "bun"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { stat } from "node:fs/promises"
import { parseDoc } from "./lib/parse-doc"
import { checkR1, checkR2, checkR3 } from "./lib/rules"
import { formatReport } from "./lib/report"
import type { ParsedDoc, Violation } from "./lib/types"

async function main(): Promise<number> {
  const docsDir = resolve(process.argv[2] ?? "docs")
  try {
    const s = await stat(docsDir)
    if (!s.isDirectory()) {
      process.stderr.write(`docs:check: not a directory: ${docsDir}\n`)
      return 2
    }
  } catch {
    process.stderr.write(`docs:check: directory not found: ${docsDir}\n`)
    return 2
  }
  const glob = new Glob("**/*.doc.ts")

  const docs: ParsedDoc[] = []
  for await (const rel of glob.scan({ cwd: docsDir, absolute: false })) {
    const abs = resolve(docsDir, rel)
    const source = await readFile(abs, "utf8")
    docs.push(parseDoc(abs, source))
  }

  const violations: Violation[] = [
    ...checkR1(docs),
    ...checkR2(docs),
    ...checkR3(docs),
  ]

  const report = formatReport(violations)
  process.stdout.write(report.text)
  return report.exitCode
}

const code = await main()
process.exit(code)
