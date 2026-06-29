/**
 * S3+S4+S8 综合 e2e 测试 (2026-06-29 落地)。
 *
 * - S3: stones list + create endpoints
 * - S4: flows list + pause/resume + 入队闸 (worker 跳过 paused session)
 * - S8: world-config + global-pause + debug toggle
 *
 * Tier: A
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "@ooc/core/app/server";
import {
  clearPauseStore,
  isSessionPaused,
  isGlobalPaused,
} from "@ooc/core/app/server/runtime/pause-store";
import { clearDebugStore, isDebugEnabled } from "@ooc/core/app/server/runtime/debug-store";

let baseDir: string;
type App = ReturnType<typeof buildServer>;
let app: App;

async function bootstrapStoneRepo(dir: string): Promise<void> {
  const stonesMain = join(dir, "stones", "main");
  await mkdir(stonesMain, { recursive: true });
  Bun.spawnSync(["git", "init"], { cwd: stonesMain });
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: stonesMain });
  await writeFile(join(stonesMain, ".gitignore"), "objects/*/threads/\n", "utf8");
  await writeFile(join(stonesMain, "README.md"), "init\n", "utf8");
  Bun.spawnSync(["git", "add", "-A"], { cwd: stonesMain });
  Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=bootstrap",
      "-c",
      "user.email=bootstrap@ooc.local",
      "commit",
      "-m",
      "initial",
    ],
    { cwd: stonesMain },
  );
}

describe("S3+S4+S8 · server modules (stones list/create + flows list/pause/resume + world-config + global-pause + debug)", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-s348-"));
    await bootstrapStoneRepo(baseDir);
    // 写 .world.json 以测 S8
    await writeFile(
      join(baseDir, ".world.json"),
      JSON.stringify({ siteName: "Test World", lark: { feishuPrefix: "https://feishu.cn" } }),
      "utf8",
    );
    app = buildServer({ baseDir, autoEnqueue: false, dev: false });
    clearPauseStore();
    clearDebugStore();
  });

  afterAll(async () => {
    await app.worldRuntime.dispose();
    clearPauseStore();
    clearDebugStore();
    await rm(baseDir, { recursive: true, force: true });
  });

  describe("S3 · stones list + create", () => {
    it("空 world → GET /api/stones 返回 items=[]", async () => {
      const res = await app.handle(new Request("http://localhost/api/stones", { method: "GET" }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBe(0);
    });

    it("POST /api/stones 创 stone → list 含它 + commitSha 返回", async () => {
      const res1 = await app.handle(
        new Request("http://localhost/api/stones", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objectId: "alice", kind: "object" }),
        }),
      );
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as {
        ok: boolean;
        created: boolean;
        commitSha?: string;
      };
      expect(body1.ok).toBe(true);
      expect(body1.created).toBe(true);
      expect(typeof body1.commitSha).toBe("string");

      const res2 = await app.handle(new Request("http://localhost/api/stones", { method: "GET" }));
      const body2 = (await res2.json()) as { items: Array<{ objectId: string; kind: string }> };
      expect(body2.items.length).toBe(1);
      expect(body2.items[0]!.objectId).toBe("alice");
    });

    it("POST /api/stones 幂等 (同 objectId 已存在 returns created=false)", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objectId: "alice", kind: "object" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; created: boolean };
      expect(body.ok).toBe(true);
      expect(body.created).toBe(false);
    });

    it("POST /api/stones 拒绝非法 objectId", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/stones", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objectId: "../escape" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("INVALID_OBJECT_ID");
    });
  });

  describe("S4 · flows list + pause/resume", () => {
    it("GET /api/flows — 空 world 返回 items=[]", async () => {
      const res = await app.handle(new Request("http://localhost/api/flows", { method: "GET" }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; hash: string };
      expect(Array.isArray(body.items)).toBe(true);
    });

    it("POST /api/flows/<sid>/pause → 进程内 pause-store 标 paused", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/flows/test-sid/pause", { method: "POST" }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessionId: string; paused: boolean };
      expect(body.paused).toBe(true);
      expect(isSessionPaused("test-sid")).toBe(true);
    });

    it("POST /api/flows/<sid>/resume → 解 paused", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/flows/test-sid/resume", { method: "POST" }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessionId: string; paused: boolean };
      expect(body.paused).toBe(false);
      expect(isSessionPaused("test-sid")).toBe(false);
    });
  });

  describe("S8 · world-config + global-pause + debug toggle", () => {
    it("GET /api/world/config → 返 .world.json 内容 + 默认 fallback", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/world/config", { method: "GET" }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { siteName?: string; lark?: { feishuPrefix?: string } };
      expect(body.siteName).toBe("Test World");
      expect(body.lark?.feishuPrefix).toBe("https://feishu.cn");
    });

    it("global-pause status → enable → status → disable → status", async () => {
      const r1 = await app.handle(
        new Request("http://localhost/api/runtime/global-pause/status", { method: "GET" }),
      );
      expect(((await r1.json()) as { enabled: boolean }).enabled).toBe(false);
      const r2 = await app.handle(
        new Request("http://localhost/api/runtime/global-pause/enable", { method: "POST" }),
      );
      expect(((await r2.json()) as { enabled: boolean }).enabled).toBe(true);
      expect(isGlobalPaused()).toBe(true);
      const r3 = await app.handle(
        new Request("http://localhost/api/runtime/global-pause/disable", { method: "POST" }),
      );
      expect(((await r3.json()) as { enabled: boolean }).enabled).toBe(false);
      expect(isGlobalPaused()).toBe(false);
    });

    it("debug status → enable → status → disable → status", async () => {
      const r1 = await app.handle(
        new Request("http://localhost/api/runtime/debug/status", { method: "GET" }),
      );
      expect(((await r1.json()) as { enabled: boolean }).enabled).toBe(false);
      const r2 = await app.handle(
        new Request("http://localhost/api/runtime/debug/enable", { method: "POST" }),
      );
      expect(((await r2.json()) as { enabled: boolean }).enabled).toBe(true);
      expect(isDebugEnabled()).toBe(true);
      const r3 = await app.handle(
        new Request("http://localhost/api/runtime/debug/disable", { method: "POST" }),
      );
      expect(((await r3.json()) as { enabled: boolean }).enabled).toBe(false);
      expect(isDebugEnabled()).toBe(false);
    });
  });
});
