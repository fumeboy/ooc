/**
 * S7+S9 综合 e2e 测试 (2026-06-29 落地)。
 *
 * - S7 job-manager: enqueueScheduler 返 jobId, GET /api/runtime/jobs/:id
 * - S9 loop debug: debug=on 后 thinkloop 落盘 loop_NNNN.{input,output,meta}.json,
 *   GET /api/runtime/flows/<sid>/<oid>/threads/<tid>/debug/loops 列表 + get 单条
 *
 * Tier: A
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "@ooc/core/app/server";
import { clearJobs, getJob, createJob, finishJob } from "@ooc/core/app/server/runtime/job-manager";
import { setDebugEnabled, isDebugEnabled } from "@ooc/core/app/server/runtime/debug-store";
import {
  releaseSessionRegistry,
  getSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants";
import type {
  LlmClient,
  LlmGenerateParams,
  LlmGenerateResult,
} from "@ooc/core/thinkable/llm/types";

let baseDir: string;
type App = ReturnType<typeof buildServer>;
let app: App;
const SESSION_ID = "s7s9-test";

const mockLlm: LlmClient = {
  async generate(_params: LlmGenerateParams): Promise<LlmGenerateResult> {
    return {
      provider: "claude",
      model: "mock",
      outputItems: [],
      text: "(mock response)",
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
  await writeFile(join(stonesMain, "README.md"), "init\n", "utf8");
  Bun.spawnSync(["git", "add", "-A"], { cwd: stonesMain });
  Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t.com",
      "commit",
      "-m",
      "init",
    ],
    { cwd: stonesMain },
  );
}

describe("S7 · job-manager + GET /api/runtime/jobs/:id", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-s7-"));
    await bootstrapStoneRepo(baseDir);
    app = buildServer({ baseDir, llm: mockLlm, autoEnqueue: true, dev: false });
    clearJobs();
  });

  afterAll(async () => {
    await app.worldRuntime.dispose();
    clearJobs();
    await rm(baseDir, { recursive: true, force: true });
  });

  it("createJob → queued; finishJob ok → done", () => {
    const job = createJob("run-thread", "sX");
    expect(job.status).toBe("queued");
    expect(job.sessionId).toBe("sX");
    finishJob(job.id, true);
    const updated = getJob(job.id);
    expect(updated?.status).toBe("done");
    expect(typeof updated?.finishedAt).toBe("number");
  });

  it("GET /api/runtime/jobs/:id — 已知 job 返回完整 Job", async () => {
    const job = createJob("run-thread", "sY");
    const res = await app.handle(
      new Request(`http://localhost/api/runtime/jobs/${job.id}`, { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string; sessionId: string };
    expect(body.id).toBe(job.id);
    expect(body.status).toBe("queued");
    expect(body.sessionId).toBe("sY");
  });

  it("GET /api/runtime/jobs/:id — 不存在 → 404 JOB_NOT_FOUND", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/runtime/jobs/nonexistent", { method: "GET" }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("JOB_NOT_FOUND");
  });
});

describe("S9 · loop debug (debug=on 落盘 + list/get endpoints)", () => {
  beforeAll(async () => {
    setDebugEnabled(true);
  });
  afterAll(async () => {
    setDebugEnabled(false);
  });

  it("debug=on 时 enqueueScheduler 真跑后落 loop_0000.{input,output,meta}.json", async () => {
    // 创 session + thread 然后跑 enqueueScheduler (autoEnqueue=true)
    releaseSessionRegistry("s9-loop");
    // POST /api/sessions 创 user.root + supervisor thread
    const res = await app.handle(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "s9-loop",
          targetObjectId: "_builtin/supervisor",
          initialMessage: "hi",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      targetThreadId: string;
      jobId?: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.jobId).toBe("string"); // S7 jobId 返回

    // 这里 autoEnqueue=false 所以 jobId 不会真触发 thinkloop。手动 enqueueScheduler:
    const { enqueueScheduler } = await import("@ooc/core/app/server/runtime/worker");
    const r = await enqueueScheduler("s9-loop", mockLlm, baseDir);
    expect(typeof r.jobId).toBe("string");

    // 等一点时间 (worker fire-and-forget; runOnce 内 await runScheduler)
    await new Promise((res) => setTimeout(res, 100));

    // 验落盘 loop_0000.{input,output,meta}.json
    const debugDir = join(
      baseDir,
      "flows",
      "s9-loop",
      "objects",
      "_builtin/supervisor",
      "threads",
      body.targetThreadId,
      "debug",
    );
    const files = await readdir(debugDir);
    expect(files).toContain("loop_0000.input.json");
    expect(files).toContain("loop_0000.output.json");
    expect(files).toContain("loop_0000.meta.json");
  });

  it("GET /api/runtime/flows/<sid>/<oid>/threads/<tid>/debug/loops — 列出 loops", async () => {
    // 用前一个 it 的产物 (s9-loop session + supervisor thread)
    const reg = getSessionRegistry("s9-loop");
    let threadId = "";
    reg.iterObjects((inst) => {
      if (inst.class === THREAD_CLASS_ID) {
        const t = inst.data as { id: string; skip_scheduling?: boolean };
        if (!t.skip_scheduling) threadId = t.id;
      }
    });
    expect(threadId).not.toBe("");

    const res = await app.handle(
      new Request(
        `http://localhost/api/runtime/flows/s9-loop/_builtin%2Fsupervisor/threads/${encodeURIComponent(threadId)}/debug/loops`,
        { method: "GET" },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      loops: Array<{ loopIndex: number; meta?: Record<string, unknown> }>;
    };
    expect(body.loops.length).toBeGreaterThan(0);
    expect(body.loops[0]!.loopIndex).toBe(0);
  });

  it("GET /api/runtime/flows/<sid>/<oid>/threads/<tid>/debug/loops/:loopIndex — 读单条", async () => {
    const reg = getSessionRegistry("s9-loop");
    let threadId = "";
    reg.iterObjects((inst) => {
      if (inst.class === THREAD_CLASS_ID) {
        const t = inst.data as { id: string; skip_scheduling?: boolean };
        if (!t.skip_scheduling) threadId = t.id;
      }
    });
    const res = await app.handle(
      new Request(
        `http://localhost/api/runtime/flows/s9-loop/_builtin%2Fsupervisor/threads/${encodeURIComponent(threadId)}/debug/loops/0`,
        { method: "GET" },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      input?: unknown;
      output?: unknown;
      meta?: Record<string, unknown>;
    };
    expect(body.ok).toBe(true);
    expect(body.input).toBeDefined();
    expect(body.output).toBeDefined();
    expect(body.meta).toBeDefined();
  });

  it("GET loop debug 不存在 → 404 LOOP_NOT_FOUND", async () => {
    const res = await app.handle(
      new Request(
        "http://localhost/api/runtime/flows/s9-loop/_builtin%2Fsupervisor/threads/nonexistent/debug/loops/0",
        { method: "GET" },
      ),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("LOOP_NOT_FOUND");
  });

  it("debug=off 时不落盘 (即使跑 thinkloop)", async () => {
    setDebugEnabled(false);
    expect(isDebugEnabled()).toBe(false);

    releaseSessionRegistry("s9-nodbg");
    await app.handle(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "s9-nodbg",
          targetObjectId: "_builtin/supervisor",
          initialMessage: "hi",
        }),
      }),
    );
    const { enqueueScheduler } = await import("@ooc/core/app/server/runtime/worker");
    await enqueueScheduler("s9-nodbg", mockLlm, baseDir);
    await new Promise((res) => setTimeout(res, 100));

    // debug 目录应不存在 (或为空)
    const reg = getSessionRegistry("s9-nodbg");
    let threadId = "";
    reg.iterObjects((inst) => {
      if (inst.class === THREAD_CLASS_ID) {
        const t = inst.data as { id: string; skip_scheduling?: boolean };
        if (!t.skip_scheduling) threadId = t.id;
      }
    });
    const debugDir = join(
      baseDir,
      "flows",
      "s9-nodbg",
      "objects",
      "_builtin/supervisor",
      "threads",
      threadId,
      "debug",
    );
    try {
      const files = await readdir(debugDir);
      expect(files.length).toBe(0); // 目录可能存在但空
    } catch (e) {
      // 目录不存在更好
      expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
    setDebugEnabled(true); // 恢复给后续 case
  });
});
