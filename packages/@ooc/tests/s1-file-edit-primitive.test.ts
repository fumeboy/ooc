/**
 * S1 file-edit / file-read 原语 e2e 测试 (issue 2026-06-29-s1, 2026-06-29 落地)。
 *
 * 覆盖:
 *   - PUT /api/stones/:id/file?path= 真写盘 + git commit
 *   - PUT 路径白名单外 → 400 NOT_WHITELISTED
 *   - PUT 路径含 `..` / 绝对路径 → 400 INVALID_PATH
 *   - GET /api/stones/:id/file?path= 读回原内容
 *   - GET 文件不存在 → 404 NOT_FOUND
 *   - GET 路径白名单外 → 400 NOT_WHITELISTED
 *
 * Tier: A (控制面确定性,零真 LLM,可 CI gate)
 * 设计权威: app/self.md L16 (通用 file-edit 原语)
 * 覆盖元素: ## app server module / ## persistable × app 交叉
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "@ooc/core/app/server";

let baseDir: string;
type App = ReturnType<typeof buildServer>;
let app: App;

/**
 * 手动 bootstrap stone repo,兼容 git 2.20+(不依赖 git init -b)。
 *
 * 不调 ensureStoneRepo() 因其用 -b flag 在老 git 上失败;S1 仅需最小 stone repo
 * 满足 httpDirectMainWrite 路径,故手动 init + initial commit 即可。
 */
async function bootstrapStoneRepo(dir: string): Promise<void> {
  const stonesMain = join(dir, "stones", "main");
  await mkdir(stonesMain, { recursive: true });
  // git init (default branch master 在老 git; 不重要)
  Bun.spawnSync(["git", "init"], { cwd: stonesMain });
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: stonesMain });
  await writeFile(join(stonesMain, ".gitignore"), "objects/*/threads/\n", "utf8");
  await writeFile(join(stonesMain, "README.md"), "S1 test bootstrap\n", "utf8");
  Bun.spawnSync(["git", "add", "-A"], { cwd: stonesMain });
  const commitArgs = [
    "-c", "user.name=bootstrap",
    "-c", "user.email=bootstrap@ooc.local",
    "commit", "-m", "S1 test initial",
  ];
  Bun.spawnSync(["git", ...commitArgs], { cwd: stonesMain });
  // 创建 test object 目录
  await mkdir(join(stonesMain, "objects", "test_obj"), { recursive: true });
}

describe("S1 · file-edit / file-read 原语 (app/self.md L16)", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-s1-"));
    await bootstrapStoneRepo(baseDir);
    app = buildServer({ baseDir, autoEnqueue: false, dev: false });
  });

  afterAll(async () => {
    await app.worldRuntime.dispose();
    await rm(baseDir, { recursive: true, force: true });
  });

  describe("PUT /api/stones/:id/file?path= (写 + commit)", () => {
    it("self.md 写入成功 → 返 commitSha", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file?path=self.md", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "# Test Object\n\n身份介绍。\n" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; objectId?: string; path?: string; commitSha?: string };
      expect(body.ok).toBe(true);
      expect(body.objectId).toBe("test_obj");
      expect(body.path).toBe("self.md");
      expect(typeof body.commitSha).toBe("string");
      expect(body.commitSha!.length).toBeGreaterThan(0);
    });

    it("knowledge/x.md 写入成功 (白名单含 knowledge/*.md)", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file?path=knowledge/intro.md", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "# Intro knowledge\n" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; path?: string };
      expect(body.ok).toBe(true);
      expect(body.path).toBe("knowledge/intro.md");
    });

    it("路径白名单外 (types.ts) → 400 NOT_WHITELISTED", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file?path=types.ts", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "export interface X {}" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("NOT_WHITELISTED");
    });

    it("路径含 `..` 段 → 400 INVALID_PATH", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file?path=../escape.md", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "x" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("INVALID_PATH");
    });

    it("路径绝对 → 400 INVALID_PATH", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file?path=/etc/passwd", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "x" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("INVALID_PATH");
    });
  });

  describe("GET /api/stones/:id/file?path= (读)", () => {
    it("读回先前 PUT 写入的 self.md 原内容", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file?path=self.md", {
          method: "GET",
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; content?: string; size?: number };
      expect(body.ok).toBe(true);
      expect(body.content).toBe("# Test Object\n\n身份介绍。\n");
      expect(body.size).toBeGreaterThan(0);
    });

    it("文件不存在 → 404 NOT_FOUND", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file?path=readable.md", {
          method: "GET",
        }),
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("NOT_FOUND");
    });

    it("路径白名单外 → 400 NOT_WHITELISTED", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file?path=package.json", {
          method: "GET",
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("NOT_WHITELISTED");
    });
  });

  describe("缺 ?path= query", () => {
    it("PUT 缺 path → 400 MISSING_PATH", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "x" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("MISSING_PATH");
    });

    it("GET 缺 path → 400 MISSING_PATH", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones/test_obj/file", { method: "GET" }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("MISSING_PATH");
    });
  });
});
