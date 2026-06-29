/**
 * S6 thread detail/list e2e 测试 (issue 2026-06-29-s6, 2026-06-29 落地)。
 *
 * 覆盖:
 *   - GET /api/flows/:sid/threads — 列 session 内全部 thread (扩展 shape)
 *   - GET /api/flows/:sid/:oid/threads/:tid — 单 thread 完整 ThreadContext 详情
 *   - 不存在的 thread → 404 THREAD_NOT_FOUND
 *
 * Tier: A
 * 设计权威: index.md §E ## thread / ## collaborable
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
const SESSION_ID = "s6-thread-test";

async function bootstrapStoneRepo(dir: string): Promise<void> {
  const stonesMain = join(dir, "stones", "main");
  await mkdir(stonesMain, { recursive: true });
  Bun.spawnSync(["git", "init"], { cwd: stonesMain });
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: stonesMain });
  await writeFile(join(stonesMain, ".gitignore"), "objects/*/threads/\n", "utf8");
  await writeFile(join(stonesMain, "README.md"), "S6 bootstrap\n", "utf8");
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

async function createThreadInst(callee: string, msg: string): Promise<ThreadContext> {
  const reg = getSessionRegistry(SESSION_ID);
  const ctor = reg.resolveConstructor(THREAD_CLASS_ID)!;
  const data = (await ctor.exec(
    {
      sessionId: SESSION_ID,
      worldDir: baseDir,
      dir: "",
      args: { calleeObjectId: callee, message: msg },
    },
    { calleeObjectId: callee, message: msg },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: THREAD_CLASS_ID, data });
  return data;
}

describe("S6 · thread list/detail", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-s6-"));
    await bootstrapStoneRepo(baseDir);
    app = buildServer({ baseDir, autoEnqueue: false, dev: false });
  });

  afterAll(async () => {
    await app.worldRuntime.dispose();
    releaseSessionRegistry(SESSION_ID);
    await rm(baseDir, { recursive: true, force: true });
  });

  it("GET /api/flows/:sid/threads — 空 session 返回 items=[]", async () => {
    releaseSessionRegistry(SESSION_ID);
    const res = await app.handle(
      new Request(`http://localhost/api/flows/${SESSION_ID}/threads`, { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; items: unknown[] };
    expect(body.sessionId).toBe(SESSION_ID);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBe(0);
  });

  it("GET /api/flows/:sid/threads — 创 2 个 thread 后含 2 条 + 扩展字段", async () => {
    releaseSessionRegistry(SESSION_ID);
    const t1 = await createThreadInst("_builtin/supervisor", "hello s1");
    const t2 = await createThreadInst("_builtin/runtime", "hello s2");
    const res = await app.handle(
      new Request(`http://localhost/api/flows/${SESSION_ID}/threads`, { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      items: Array<{
        threadId: string;
        status: string;
        messageCount: number;
        eventCount: number;
        lastEventAt?: number;
        calleeObjectId?: string;
      }>;
    };
    expect(body.items.length).toBe(2);
    const tids = body.items.map((i) => i.threadId).sort();
    expect(tids).toEqual([t1.id, t2.id].sort());
    const it1 = body.items.find((i) => i.threadId === t1.id)!;
    expect(it1.messageCount).toBe(1);
    expect(it1.calleeObjectId).toBe("_builtin/supervisor");
    expect(it1.status).toBe("running");
    expect(typeof it1.lastEventAt).toBe("number");
  });

  it("GET /api/flows/:sid/:oid/threads/:tid — 单 thread 完整 ThreadContext", async () => {
    releaseSessionRegistry(SESSION_ID);
    const t = await createThreadInst("_builtin/supervisor", "hello detail");
    const res = await app.handle(
      new Request(
        `http://localhost/api/flows/${SESSION_ID}/_builtin%2Fsupervisor/threads/${encodeURIComponent(t.id)}`,
        { method: "GET" },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ThreadContext;
    expect(body.id).toBe(t.id);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.calleeObjectId).toBe("_builtin/supervisor");
    expect(body.messages.length).toBe(1);
    expect(body.messages[0]!.content).toBe("hello detail");
    expect(Array.isArray(body.events)).toBe(true);
    expect(Array.isArray(body.contextWindows)).toBe(true);
    expect(body.contextWindows.length).toBeGreaterThan(0);
  });

  it("GET thread 不存在 → 404 THREAD_NOT_FOUND", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/flows/${SESSION_ID}/_builtin%2Fsupervisor/threads/non_existent_thread`,
        { method: "GET" },
      ),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("THREAD_NOT_FOUND");
  });
});
