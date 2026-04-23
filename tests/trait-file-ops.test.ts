/**
 * file_ops trait 单元测试
 *
 * 测试文件读写、编辑、目录操作的全部 6 个方法。
 * 使用临时目录作为 fixture，测试完毕后清理。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile as fsWriteFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  readFile,
  editFile,
  writeFile,
  listDir,
  fileExists,
  deleteFile,
} from "../traits/computable/file_ops/index";

/** 模拟上下文，rootDir 设为空字符串，测试中使用绝对路径 */
const ctx = { rootDir: "" } as any;

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ooc-file-ops-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── readFile ───────────────────────────────────────────

describe("readFile", () => {
  test("读取完整文件，带行号", async () => {
    const filePath = join(tempDir, "read-full.txt");
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    await fsWriteFile(filePath, lines.join("\n"));

    const result = await readFile(ctx, filePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totalLines).toBe(10);
    expect(result.data.truncated).toBe(false);
    expect(result.data.content).toContain(" 1 | line 1");
    expect(result.data.content).toContain("10 | line 10");
  });

  test("offset + limit 分页读取", async () => {
    const filePath = join(tempDir, "read-paged.txt");
    const lines = Array.from({ length: 50 }, (_, i) => `L${i + 1}`);
    await fsWriteFile(filePath, lines.join("\n"));

    const result = await readFile(ctx, filePath, { offset: 10, limit: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totalLines).toBe(50);
    expect(result.data.truncated).toBe(true);
    expect(result.data.content).toContain("11 | L11");
    expect(result.data.content).toContain("15 | L15");
    expect(result.data.content).not.toContain("16 | L16");
  });

  test("文件不存在返回错误", async () => {
    const result = await readFile(ctx, join(tempDir, "nonexistent.txt"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("不存在");
  });
});

// ─── editFile ───────────────────────────────────────────

describe("editFile", () => {
  test("精确匹配替换", async () => {
    const filePath = join(tempDir, "edit-exact.txt");
    await fsWriteFile(filePath, "hello world\nfoo bar\n");

    const result = await editFile(ctx, filePath, "foo bar", "baz qux");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.matchCount).toBe(1);
    // diff 字段：before/after 完整文本 + path（前端卡片标题用）
    expect(result.data.before).toBe("hello world\nfoo bar\n");
    expect(result.data.after).toBe("hello world\nbaz qux\n");
    expect(result.data.path).toBe(filePath);

    const content = await Bun.file(filePath).text();
    expect(content).toBe("hello world\nbaz qux\n");
  });

  test("空白容错匹配（trim whitespace）", async () => {
    const filePath = join(tempDir, "edit-fuzzy.txt");
    await fsWriteFile(filePath, "  hello  \n  world  \nend\n");

    // oldStr 没有前后空白，但文件中有
    const result = await editFile(ctx, filePath, "hello\nworld", "replaced");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.matchCount).toBe(1);
    // diff 字段：before/after 完整文本（容错分支也需要返回）
    expect(result.data.before).toBe("  hello  \n  world  \nend\n");
    expect(result.data.after).toContain("replaced");
    expect(result.data.after).not.toContain("hello");

    const content = await Bun.file(filePath).text();
    expect(content).toContain("replaced");
    expect(content).not.toContain("hello");
  });

  test("无匹配返回错误和上下文", async () => {
    const filePath = join(tempDir, "edit-nomatch.txt");
    await fsWriteFile(filePath, "alpha beta gamma\n");

    const result = await editFile(ctx, filePath, "not found text", "x");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("未找到");
    expect(result.context).toContain("alpha beta gamma");
  });

  test("多处匹配但未设 replaceAll 返回错误", async () => {
    const filePath = join(tempDir, "edit-multi.txt");
    await fsWriteFile(filePath, "aaa\nbbb\naaa\n");

    const result = await editFile(ctx, filePath, "aaa", "ccc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("2");
    expect(result.error).toContain("replaceAll");
  });

  test("replaceAll 替换所有匹配", async () => {
    const filePath = join(tempDir, "edit-replaceall.txt");
    await fsWriteFile(filePath, "aaa\nbbb\naaa\n");

    const result = await editFile(ctx, filePath, "aaa", "ccc", {
      replaceAll: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.matchCount).toBe(2);
    // diff 字段：before/after 完整文本
    expect(result.data.before).toBe("aaa\nbbb\naaa\n");
    expect(result.data.after).toBe("ccc\nbbb\nccc\n");

    const content = await Bun.file(filePath).text();
    expect(content).toBe("ccc\nbbb\nccc\n");
  });
});

// ─── writeFile ──────────────────────────────────────────

describe("writeFile", () => {
  test("创建新文件", async () => {
    const filePath = join(tempDir, "write-new.txt");
    const result = await writeFile(ctx, filePath, "Hello World");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bytesWritten).toBe(11);
    // 写新文件：before 应为空串，after 为新内容（前端据此渲染"全文绿色 (new file)"）
    expect(result.data.before).toBe("");
    expect(result.data.after).toBe("Hello World");
    expect(result.data.path).toBe(filePath);

    const content = await Bun.file(filePath).text();
    expect(content).toBe("Hello World");
  });

  test("覆写已存在文件携带 before/after", async () => {
    const filePath = join(tempDir, "write-overwrite.txt");
    await fsWriteFile(filePath, "old content");

    const result = await writeFile(ctx, filePath, "new content");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 覆写已存在文件：before = 旧内容，after = 新内容
    expect(result.data.before).toBe("old content");
    expect(result.data.after).toBe("new content");

    const content = await Bun.file(filePath).text();
    expect(content).toBe("new content");
  });

  test("自动创建父目录", async () => {
    const filePath = join(tempDir, "deep", "nested", "dir", "file.txt");
    const result = await writeFile(ctx, filePath, "nested content");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 父目录新建场景：文件本身不存在，before 应为空串
    expect(result.data.before).toBe("");
    expect(result.data.after).toBe("nested content");

    const content = await Bun.file(filePath).text();
    expect(content).toBe("nested content");
  });
});

// ─── listDir ────────────────────────────────────────────

describe("listDir", () => {
  test("列出目录基本内容", async () => {
    const dir = join(tempDir, "listdir-basic");
    await mkdir(dir);
    await fsWriteFile(join(dir, "a.txt"), "a");
    await fsWriteFile(join(dir, "b.txt"), "bb");
    await mkdir(join(dir, "sub"));

    const result = await listDir(ctx, dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const names = result.data.entries.map((e) => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(names).toContain("sub");

    const subEntry = result.data.entries.find((e) => e.name === "sub");
    expect(subEntry?.type).toBe("directory");
  });

  test("limit 限制返回条目数", async () => {
    const dir = join(tempDir, "listdir-limit");
    await mkdir(dir);
    for (let i = 0; i < 10; i++) {
      await fsWriteFile(join(dir, `file${i}.txt`), "x");
    }

    const result = await listDir(ctx, dir, { limit: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries.length).toBe(3);
  });
});

// ─── fileExists ─────────────────────────────────────────

describe("fileExists", () => {
  test("存在的文件返回 true", async () => {
    const filePath = join(tempDir, "exists-yes.txt");
    await fsWriteFile(filePath, "x");

    const result = await fileExists(ctx, filePath);
    expect(result).toBe(true);
  });

  test("不存在的文件返回 false", async () => {
    const result = await fileExists(ctx, join(tempDir, "nope.txt"));
    expect(result).toBe(false);
  });
});

// ─── deleteFile ─────────────────────────────────────────

describe("deleteFile", () => {
  test("删除文件", async () => {
    const filePath = join(tempDir, "delete-me.txt");
    await fsWriteFile(filePath, "bye");

    const result = await deleteFile(ctx, filePath);
    expect(result.ok).toBe(true);

    const exists = await fileExists(ctx, filePath);
    expect(exists).toBe(false);
  });

  test("递归删除目录", async () => {
    const dir = join(tempDir, "delete-dir");
    await mkdir(dir);
    await fsWriteFile(join(dir, "inner.txt"), "x");

    const result = await deleteFile(ctx, dir, { recursive: true });
    expect(result.ok).toBe(true);

    const exists = await fileExists(ctx, dir);
    expect(exists).toBe(false);
  });
});

// ─── Edit Plan Transaction ───────────────────────────────

describe("plan_edits / apply_edits", () => {
  test("通过 trait ctx 创建 plan 并应用", async () => {
    const { planEdits, applyEdits, previewEditPlanMethod } = await import(
      "../traits/computable/file_ops/index"
    );
    const planDir = join(tempDir, "plan-work");
    await mkdir(planDir, { recursive: true });
    await fsWriteFile(join(planDir, "a.ts"), "export const A = 1;\n");
    await fsWriteFile(join(planDir, "b.ts"), "export const B = 2;\n");

    const planCtx = { rootDir: planDir, sessionId: "trait-test" };
    const planRes = await planEdits(planCtx, [
      { kind: "edit", path: "a.ts", oldText: "A = 1", newText: "A = 100" },
      { kind: "edit", path: "b.ts", oldText: "B = 2", newText: "B = 200" },
    ]);
    expect(planRes.ok).toBe(true);
    if (!planRes.ok) return;
    expect(planRes.data.changesCount).toBe(2);
    expect(planRes.data.preview).toContain("--- a/a.ts");

    const prev = await previewEditPlanMethod(planCtx, planRes.data.planId);
    expect(prev.ok).toBe(true);

    const apply = await applyEdits(planCtx, planRes.data.planId);
    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    expect(apply.data.applied).toBe(2);
    // 多文件 transaction：每个 perChange 应携带 before/after 供前端 diff 渲染
    expect(apply.data.perChange.length).toBe(2);
    const aChange = apply.data.perChange.find((c) => c.path === "a.ts");
    const bChange = apply.data.perChange.find((c) => c.path === "b.ts");
    expect(aChange?.before).toBe("export const A = 1;\n");
    expect(aChange?.after).toBe("export const A = 100;\n");
    expect(bChange?.before).toBe("export const B = 2;\n");
    expect(bChange?.after).toBe("export const B = 200;\n");

    const { readFile: fsReadFile } = await import("fs/promises");
    const a = await fsReadFile(join(planDir, "a.ts"), "utf-8");
    expect(a).toContain("A = 100");
    const b = await fsReadFile(join(planDir, "b.ts"), "utf-8");
    expect(b).toContain("B = 200");
  });

  test("applyEdits write 新文件携带 before='' / after=newContent", async () => {
    const { planEdits, applyEdits } = await import(
      "../traits/computable/file_ops/index"
    );
    const planDir = join(tempDir, "plan-write-new");
    await mkdir(planDir, { recursive: true });

    const planCtx = { rootDir: planDir, sessionId: "trait-test-write" };
    const planRes = await planEdits(planCtx, [
      { kind: "write", path: "newfile.ts", newContent: "export const X = 1;\n" },
    ]);
    expect(planRes.ok).toBe(true);
    if (!planRes.ok) return;

    const apply = await applyEdits(planCtx, planRes.data.planId);
    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    expect(apply.data.perChange[0]?.before).toBe("");
    expect(apply.data.perChange[0]?.after).toBe("export const X = 1;\n");
  });
});
