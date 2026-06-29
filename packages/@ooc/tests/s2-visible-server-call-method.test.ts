/**
 * S2 visible/server callMethod e2e 测试 (issue 2026-06-29-s2, 2026-06-29 落地)。
 *
 * 覆盖:
 *   - POST /api/flows/:sid/:oid/call_method 成功调 visible/server method
 *   - method 改 data → persistable.save (scope=flow) 触发, 再读回看见变更
 *   - method 不存在 → 404 METHOD_NOT_FOUND
 *   - class 无 visible/server → 400 NO_VISIBLE_SERVER
 *   - object 不存在 → 404 OBJECT_NOT_FOUND
 *
 * Tier: A (控制面确定性,零真 LLM,可 CI gate)
 * 设计权威: visible/self.md ## 核心设计 + index.md §B ## visible
 *   "ctx 有 world/session/object-self、无 thinkloop thread;改 data → persistable.save 非版本化"
 *   "HTTP /call_method dispatch — 仅 flow scope, stone scope 只读"
 * 覆盖元素: ## visible / ## visible × app / ## visible × persistable / ## thread builtin
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "@ooc/core/app/server";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";

let baseDir: string;
type App = ReturnType<typeof buildServer>;
let app: App;
const SESSION_ID = "s2-visible-test";

async function bootstrapStoneRepo(dir: string): Promise<void> {
  const stonesMain = join(dir, "stones", "main");
  await mkdir(stonesMain, { recursive: true });
  Bun.spawnSync(["git", "init"], { cwd: stonesMain });
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: stonesMain });
  await writeFile(join(stonesMain, ".gitignore"), "objects/*/threads/\n", "utf8");
  await writeFile(join(stonesMain, "README.md"), "S2 bootstrap\n", "utf8");
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

async function createThreadInst(): Promise<ThreadContext> {
  const reg = getSessionRegistry(SESSION_ID);
  const ctor = reg.resolveConstructor(THREAD_CLASS_ID)!;
  const data = (await ctor.exec(
    {
      sessionId: SESSION_ID,
      worldDir: baseDir,
      dir: "",
      args: { calleeObjectId: "_builtin/supervisor", message: "hello" },
    },
    { calleeObjectId: "_builtin/supervisor", message: "hello" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: THREAD_CLASS_ID, data });
  return data;
}

describe("S2 · visible/server callMethod (POST /api/flows/:sid/:oid/call_method)", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-s2-"));
    await bootstrapStoneRepo(baseDir);
    app = buildServer({ baseDir, autoEnqueue: false, dev: false });
  });

  afterAll(async () => {
    await app.worldRuntime.dispose();
    releaseSessionRegistry(SESSION_ID);
    await rm(baseDir, { recursive: true, force: true });
  });

  it("markRead 成功 → 改 data + 返回 ok", async () => {
    const thread = await createThreadInst();
    const res = await app.handle(
      new Request(
        `http://localhost/api/flows/${SESSION_ID}/${encodeURIComponent(thread.id)}/call_method`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "markRead", args: {} }),
        },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { ok?: boolean; messageId?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.ok).toBe(true);
    expect(typeof body.data?.messageId).toBe("string");
    // 数据被改: thread inst 现持 readUpToMessageId
    const reg = getSessionRegistry(SESSION_ID);
    const inst = reg.getObject(thread.id)!;
    const data = inst.data as ThreadContext & { readUpToMessageId?: string };
    expect(data.readUpToMessageId).toBe(body.data!.messageId!);
  });

  it("mute 设 mutedUntil + unmute 删除", async () => {
    const thread = await createThreadInst();
    // mute
    const r1 = await app.handle(
      new Request(
        `http://localhost/api/flows/${SESSION_ID}/${encodeURIComponent(thread.id)}/call_method`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "mute", args: { until: 9999999999 } }),
        },
      ),
    );
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { ok: boolean; data?: { mutedUntil?: number } };
    expect(b1.ok).toBe(true);
    expect(b1.data?.mutedUntil).toBe(9999999999);
    // unmute
    const r2 = await app.handle(
      new Request(
        `http://localhost/api/flows/${SESSION_ID}/${encodeURIComponent(thread.id)}/call_method`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "unmute", args: {} }),
        },
      ),
    );
    expect(r2.status).toBe(200);
  });

  it("method 不存在 → 404 METHOD_NOT_FOUND", async () => {
    const thread = await createThreadInst();
    const res = await app.handle(
      new Request(
        `http://localhost/api/flows/${SESSION_ID}/${encodeURIComponent(thread.id)}/call_method`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "nonExistent", args: {} }),
        },
      ),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("METHOD_NOT_FOUND");
  });

  it("object 不存在 → 404 OBJECT_NOT_FOUND", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/flows/${SESSION_ID}/non_existent_obj/call_method`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "markRead", args: {} }),
        },
      ),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("OBJECT_NOT_FOUND");
  });

  it("class 无 visible/server → 400 NO_VISIBLE_SERVER", async () => {
    // 创建一个 instance,class 是 filesystem (无 visible/server)
    const reg = getSessionRegistry(SESSION_ID);
    reg.setObject({ id: "_builtin/filesystem_test", class: "_builtin/filesystem", data: {} });
    const res = await app.handle(
      new Request(
        `http://localhost/api/flows/${SESSION_ID}/_builtin%2Ffilesystem_test/call_method`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "anything", args: {} }),
        },
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("NO_VISIBLE_SERVER");
  });
});
