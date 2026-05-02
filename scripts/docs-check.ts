#!/usr/bin/env bun
// docs:check —— 检查 docs/ 下 .doc.ts 文件的版本号 review 戳合法性
// 用法：bun run docs:check [docsDir]
// 默认 docsDir = process.cwd()/docs

import { resolve } from "node:path"

async function main(): Promise<number> {
  const docsDir = resolve(process.argv[2] ?? "docs")
  console.log(`docs:check scanning ${docsDir}`)
  // TODO: 后续 task 填充
  return 0
}

const code = await main()
process.exit(code)
