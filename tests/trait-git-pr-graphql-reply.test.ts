/**
 * git/pr — commentOnPr.inReplyTo GraphQL 行为单测
 *
 * 设计要点：
 * - 本机不一定装 gh CLI，所以用 `OOC_GH_STUB` 环境变量把 gh 指向一个测试用桩脚本。
 * - 桩脚本（TypeScript 生成）把传入的 argv + stdin 落盘，根据前缀返回伪 JSON，
 *   让 commentOnPr 的两条路径（顶层评论 / inReplyTo）都能被验证。
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_git_pr_advanced.md — implements — Phase 2
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commentOnPr, llm_methods } from "../../library/traits/git/pr/index";

// ─── 桩目录 ────────────────────────────────────────────────

let STUB_DIR = "";
let ORIG_PATH = "";
const LOG_FILE_ENV = "OOC_GH_STUB_LOG";

/** 生成一个能落盘 argv/stdin 并按场景返回结果的 gh 桩 */
function writeGhStub(dir: string, logFile: string) {
  const ghStub = join(dir, "gh");
  const script = `#!/bin/bash
LOG="$${LOG_FILE_ENV}"
echo "--CALL--" >> "$LOG"
echo "ARGS: $@" >> "$LOG"
# 捕获 stdin（仅在 -F body=@- 这类场景）
if [ ! -t 0 ]; then
  STDIN="$(cat)"
  echo "STDIN: $STDIN" >> "$LOG"
fi

# gh --version 探测：返回正常字符串 & exit 0
if [[ "$1" == "--version" ]]; then
  echo "gh version 2.0.0 (stub)"
  exit 0
fi

# Scenario: gh api repos/:owner/:repo/pulls/comments/:id  → 返回含 node_id 的 JSON
if [[ "$1" == "api" && "$2" == repos/*/pulls/comments/* ]]; then
  echo '{"id": 999, "node_id": "PRRC_lookedup_node_id", "user": {"login":"x"}, "body":"orig"}'
  exit 0
fi

# Scenario: gh api graphql -f query=... —— addPullRequestReviewComment mutation
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  # 模拟成功返回新 comment node id
  echo '{"data":{"addPullRequestReviewComment":{"comment":{"id":"PRRC_new_reply_id","body":"replied"}}}}'
  exit 0
fi

# Scenario: gh pr view ... --json url → 返回伪 url 以解析 owner/repo
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  echo '{"url":"https://github.com/acme/widgets/pull/42"}'
  exit 0
fi

# Default: 顶层评论（gh pr comment）—— 忠实记录后成功退出
if [[ "$1" == "pr" && "$2" == "comment" ]]; then
  exit 0
fi

echo "stub: unknown invocation $@" >&2
exit 99
`;
  writeFileSync(ghStub, script);
  chmodSync(ghStub, 0o755);
  return ghStub;
}

beforeAll(() => {
  STUB_DIR = mkdtempSync(join(tmpdir(), "ooc-gh-stub-"));
  const logFile = join(STUB_DIR, "call.log");
  writeGhStub(STUB_DIR, logFile);
  ORIG_PATH = process.env.PATH ?? "";
  process.env.PATH = `${STUB_DIR}:${ORIG_PATH}`;
  process.env[LOG_FILE_ENV] = logFile;
  writeFileSync(logFile, ""); /* 清空 */
});

afterAll(() => {
  process.env.PATH = ORIG_PATH;
  if (STUB_DIR) rmSync(STUB_DIR, { recursive: true, force: true });
});

function readLog(): string {
  const f = process.env[LOG_FILE_ENV]!;
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

function resetLog() {
  writeFileSync(process.env[LOG_FILE_ENV]!, "");
}

// ─── 测试用例 ─────────────────────────────────────────────

describe("git/pr — comment_on_pr GraphQL reply", () => {
  test("顶层评论（无 inReplyTo）走 gh pr comment 路径", async () => {
    resetLog();
    const ctx = { rootDir: process.cwd() } as any;
    const r = await commentOnPr(ctx, { number: 42, body: "顶层评论" });
    expect(r.ok).toBe(true);
    const log = readLog();
    expect(log).toContain("pr comment 42");
    expect(log).not.toContain("graphql");
  });

  test("带 inReplyTo（数字 ID）：先查 node_id 再走 graphql", async () => {
    resetLog();
    const ctx = { rootDir: process.cwd() } as any;
    const r = await commentOnPr(ctx, {
      number: 42,
      body: "回复 review",
      inReplyTo: "999",
    });
    expect(r.ok).toBe(true);
    const log = readLog();
    /* 期望：先调 pr view 查仓库，再调 api lookup comment node_id，最后 graphql mutation */
    expect(log).toContain("pulls/comments/999");
    expect(log).toContain("graphql");
  });

  test("带 inReplyTo（PRRC_ 开头的 node_id）：直接走 graphql，不查 lookup", async () => {
    resetLog();
    const ctx = { rootDir: process.cwd() } as any;
    const r = await commentOnPr(ctx, {
      number: 42,
      body: "回复",
      inReplyTo: "PRRC_directnodeid",
    });
    expect(r.ok).toBe(true);
    const log = readLog();
    expect(log).toContain("graphql");
    expect(log).not.toContain("pulls/comments/PRRC_");
  });

  test("inReplyTo 非法格式（既非 PRRC_ 也非纯数字）应返回 error", async () => {
    resetLog();
    const ctx = { rootDir: process.cwd() } as any;
    const r = await commentOnPr(ctx, {
      number: 42,
      body: "回复",
      inReplyTo: "not-valid",
    });
    expect(r.ok).toBe(false);
  });

  test("llm_methods.comment_on_pr 的 inReplyTo 参数保留", () => {
    const p = llm_methods.comment_on_pr!.params.find(x => x.name === "inReplyTo");
    expect(p).toBeDefined();
    expect(p!.required).toBe(false);
  });
});

// ─── gh CLI 缺失路径 ──────────────────────────────────────

describe("git/pr — gh CLI 缺失时 inReplyTo 报清晰错误", () => {
  test("当 PATH 里没有 gh 时，带 inReplyTo 应返回 gh_cli_missing", async () => {
    /* 临时把 PATH 清空 stub */
    const savedPath = process.env.PATH;
    process.env.PATH = "/nonexistent-bin-dir";
    try {
      const ctx = { rootDir: process.cwd() } as any;
      const r = await commentOnPr(ctx, {
        number: 42,
        body: "reply",
        inReplyTo: "PRRC_xxx",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.toLowerCase()).toContain("gh");
      }
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
