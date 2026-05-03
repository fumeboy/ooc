// docs:check 端到端集成测试
// 通过 spawnSync 真实启动 CLI，喂临时 fixture 目录，断言 stdout 与退出码。

import { describe, expect, it, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const CLI_PATH = join(import.meta.dir, "../../scripts/docs-check.ts")

async function setupTmpDocs(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "docs-check-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    await mkdir(join(full, ".."), { recursive: true })
    await writeFile(full, content, "utf8")
  }
  return dir
}

function runCli(docsDir: string): { stdout: string; stderr: string; code: number } {
  const r = spawnSync("bun", [CLI_PATH, docsDir], { encoding: "utf8" })
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 }
}

describe("docs:check integration", () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it("空 docs 目录 → OK", async () => {
    dir = await setupTmpDocs({})
    const r = runCli(dir)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("OK")
    expect(r.stderr).toBe("")
  })

  it("单个合法 entry doc → OK", async () => {
    dir = await setupTmpDocs({
      "a.doc.ts": [
        "// @docs-entry",
        "export const X_v20260503_1 = `body`",
      ].join("\n"),
    })
    const r = runCli(dir)
    expect(r.code).toBe(0)
    expect(r.stderr).toBe("")
  })

  it("缺 review 戳 → R1 error 退出 1", async () => {
    dir = await setupTmpDocs({
      "a.doc.ts": [
        "// @docs-entry",
        "export const X_v20260503_1 = `body`",
      ].join("\n"),
      "b.doc.ts": [
        'import { X_v20260503_1 } from "./a.doc"',
        "export const Y_v20260503_1 = `${X_v20260503_1}`",
      ].join("\n"),
    })
    const r = runCli(dir)
    expect(r.code).toBe(1)
    expect(r.stdout).toContain("R1")
  })

  it("完整合法的双文档 → OK", async () => {
    dir = await setupTmpDocs({
      "a.doc.ts": [
        "// @docs-entry",
        "export const X_v20260503_1 = `body`",
      ].join("\n"),
      "b.doc.ts": [
        "// @docs-entry",
        "",
        "// @reviewed X_v20260503_1 by alan @ 2026-05-03",
        "// 确认说明：仍然适用",
        'import { X_v20260503_1 } from "./a.doc"',
        "export const Y_v20260503_1 = `${X_v20260503_1}`",
      ].join("\n"),
    })
    const r = runCli(dir)
    expect(r.code).toBe(0)
    expect(r.stderr).toBe("")
  })

  it("孤立非 entry 文件 → R3 warning 不阻塞退出", async () => {
    dir = await setupTmpDocs({
      "a.doc.ts": "export const X_v20260503_1 = `body`",
    })
    const r = runCli(dir)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("R3")
    expect(r.stderr).toBe("")
  })

  it("不存在的 docsDir → exit 2 + stderr 提示", async () => {
    const r = runCli("/tmp/__nonexistent-docs-check-dir-xyz__")
    expect(r.code).toBe(2)
    expect(r.stderr).toContain("directory not found")
  })
})
