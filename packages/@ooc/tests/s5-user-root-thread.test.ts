/**
 * S5 sessions + user.root thread (skip_scheduling=true) e2e (issue 2026-06-29-s5, 2026-06-29 落地)。
 *
 * 覆盖:
 *   - POST /api/sessions 创建 user + user.root (skip_scheduling=true) + target thread
 *   - user.rootThreadId 字段正确填回
 *   - user.root.contextWindows 含 target thread ref
 *   - user.root 不参与 scheduler 调度(skip_scheduling=true)
 *   - POST /api/flows/<sid>/talk-windows 加新 target thread + 幂等
 *   - POST /api/flows/<sid>/continue 投递 message 到 target thread.transcript
 *
 * Tier: A
 * 设计权威: 用户裁决 2026-06-29 + collaborable/self.md + thread/types.ts skip_scheduling
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "@ooc/core/app/server";
import {
  getSessionRegistry,
  releaseSessionRegistry,
  iterateSessionObjectTable,
} from "@ooc/core/runtime/object-registry";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type {
  LlmClient,
  LlmGenerateParams,
  LlmGenerateResult,
} from "@ooc/core/thinkable/llm/types";

let baseDir: string;
type App = ReturnType<typeof buildServer>;
let app: App;
const SESSION_ID = "s5-user-root-test";

const mockLlm: LlmClient = {
  async generate(_params: LlmGenerateParams): Promise<LlmGenerateResult> {
    return {
      provider: "claude",
      model: "mock",
      outputItems: [],
      text: "(mock)",
      toolCalls: [],
    };
  },
};

async function bootstrapStoneRepo(dir: string): Promise<void> {
  const stonesMain = join(dir, "stones", "main");
  await mkdir(stonesMain, { recursive: true });
  Bun.spawnSync(["git", "init"], { cwd: stonesMain });
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: stonesMain });
  await writeFile(join(stonesMain, ".gitignore"), "objects/*/threads/\n", "utf8");
  await writeFile(join(stonesMain, "README.md"), "S5 bootstrap\n", "utf8");
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

describe("S5 · sessions + user.root thread (skip_scheduling)", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-s5-"));
    await bootstrapStoneRepo(baseDir);
    app = buildServer({ baseDir, llm: mockLlm, autoEnqueue: false, dev: false });
  });

  afterAll(async () => {
    await app.worldRuntime.dispose();
    releaseSessionRegistry(SESSION_ID);
    await rm(baseDir, { recursive: true, force: true });
  });

  it("POST /api/sessions 创建 user + user.root (skip_scheduling=true) + target thread", async () => {
    releaseSessionRegistry(SESSION_ID);
    const res = await app.handle(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: SESSION_ID,
          targetObjectId: "_builtin/supervisor",
          initialMessage: "hello supervisor",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      sessionId: string;
      userObjectId: string;
      userRootThreadId: string;
      targetObjectId: string;
      targetThreadId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.userObjectId).toBe("user");
    expect(typeof body.userRootThreadId).toBe("string");
    expect(body.targetObjectId).toBe("_builtin/supervisor");
    expect(typeof body.targetThreadId).toBe("string");
    expect(body.userRootThreadId).not.toBe(body.targetThreadId);

    // 验证 user inst
    const reg = getSessionRegistry(SESSION_ID);
    const userInst = reg.getObject("user")!;
    expect(userInst.class).toBe("_builtin/user");
    expect((userInst.data as { rootThreadId?: string }).rootThreadId).toBe(body.userRootThreadId);

    // 验证 user.root thread skip_scheduling=true
    const rootInst = reg.getObject(body.userRootThreadId)!;
    expect(rootInst.class).toBe(THREAD_CLASS_ID);
    const rootData = rootInst.data as ThreadContext;
    expect(rootData.skip_scheduling).toBe(true);
    // user.root.contextWindows 含 target thread ref
    const targetRef = rootData.contextWindows.find((w) => w.id === body.targetThreadId);
    expect(targetRef).toBeDefined();
    expect(targetRef!.class).toBe(THREAD_CLASS_ID);

    // 验证 target thread 含 initialMessage
    const targetInst = reg.getObject(body.targetThreadId)!;
    const targetData = targetInst.data as ThreadContext;
    expect(targetData.messages.length).toBe(1);
    expect(targetData.messages[0]!.content).toBe("hello supervisor");
    expect(targetData.messages[0]!.from).toBe("caller");
    expect(targetData.skip_scheduling).toBeUndefined();
  });

  it("scheduler 跳过 user.root (skip_scheduling=true)", async () => {
    // 利用 iterateSessionObjectTable 验证 — 模仿 scheduler 过滤逻辑
    const reg = getSessionRegistry(SESSION_ID);
    const userInst = reg.getObject("user")!;
    const userRootThreadId = (userInst.data as { rootThreadId: string }).rootThreadId;

    const runnable: string[] = [];
    iterateSessionObjectTable(SESSION_ID, (inst) => {
      if (inst.class !== THREAD_CLASS_ID) return;
      const t = inst.data as ThreadContext;
      if (t.skip_scheduling) return;
      if (t.status !== "running" && t.status !== "waiting") return;
      runnable.push(t.id);
    });
    // user.root 不在 runnable 中, target thread 在 (status="running")
    expect(runnable).not.toContain(userRootThreadId);
    expect(runnable.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/flows/<sid>/talk-windows 加新 target thread", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/flows/${SESSION_ID}/talk-windows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetObjectId: "_builtin/runtime",
          initialMessage: "hello runtime",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      created: boolean;
      targetObjectId: string;
      targetThreadId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.targetObjectId).toBe("_builtin/runtime");

    // user.root.contextWindows 含两个 target thread refs 了
    const reg = getSessionRegistry(SESSION_ID);
    const userInst = reg.getObject("user")!;
    const rootInst = reg.getObject((userInst.data as { rootThreadId: string }).rootThreadId)!;
    const rootData = rootInst.data as ThreadContext;
    expect(rootData.contextWindows.length).toBe(2);
  });

  it("POST /api/flows/<sid>/talk-windows 幂等 (同 target 已存在则不重建)", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/flows/${SESSION_ID}/talk-windows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetObjectId: "_builtin/runtime",
          initialMessage: "duplicate",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; created: boolean };
    expect(body.ok).toBe(true);
    expect(body.created).toBe(false); // 幂等
    // user.root.contextWindows 仍是 2 个
    const reg = getSessionRegistry(SESSION_ID);
    const userInst = reg.getObject("user")!;
    const rootInst = reg.getObject((userInst.data as { rootThreadId: string }).rootThreadId)!;
    const rootData = rootInst.data as ThreadContext;
    expect(rootData.contextWindows.length).toBe(2);
  });

  it("POST /api/flows/<sid>/continue 投递 message 到 target thread.transcript", async () => {
    // 取 user.root.contextWindows 中第二个 (runtime) 的 thread id
    const reg = getSessionRegistry(SESSION_ID);
    const userInst = reg.getObject("user")!;
    const rootInst = reg.getObject((userInst.data as { rootThreadId: string }).rootThreadId)!;
    const rootData = rootInst.data as ThreadContext;
    const runtimeThreadRef = rootData.contextWindows[1]!;
    const runtimeThreadId = runtimeThreadRef.id;

    const res = await app.handle(
      new Request(`http://localhost/api/flows/${SESSION_ID}/continue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "second message from user",
          targetWindowId: runtimeThreadId,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; targetThreadId: string };
    expect(body.ok).toBe(true);
    expect(body.targetThreadId).toBe(runtimeThreadId);

    // 验证 target thread.messages 加了一条
    const targetInst = reg.getObject(runtimeThreadId)!;
    const targetData = targetInst.data as ThreadContext;
    expect(targetData.messages.length).toBe(2); // initial + new
    expect(targetData.messages[1]!.content).toBe("second message from user");
    expect(targetData.messages[1]!.from).toBe("caller");
  });

  it("POST /api/flows/<sid>/continue 缺省 targetWindowId 取末尾 thread", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/flows/${SESSION_ID}/continue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "fallback last thread" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; targetThreadId: string };
    expect(body.ok).toBe(true);
    // 末尾是 runtime thread (后加入的)
    const reg = getSessionRegistry(SESSION_ID);
    const userInst = reg.getObject("user")!;
    const rootInst = reg.getObject((userInst.data as { rootThreadId: string }).rootThreadId)!;
    const rootData = rootInst.data as ThreadContext;
    const lastRef = rootData.contextWindows[rootData.contextWindows.length - 1]!;
    expect(body.targetThreadId).toBe(lastRef.id);
  });
});
