/**
 * HTTP app server smoke test —— 验证 health / runtime endpoints + auto-enqueue。
 */
import { describe, it, expect } from "bun:test";
import { buildServer } from "@ooc/core/app/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LlmClient,
  LlmGenerateParams,
  LlmGenerateResult,
} from "@ooc/core/thinkable/llm/types";

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

describe("app server", () => {
  it("GET /health returns ok", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-srv-test-"));
    const app = buildServer({ baseDir, llm: mockLlm, autoEnqueue: false, dev: false });
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    await app.worldRuntime.dispose();
    await rm(baseDir, { recursive: true, force: true });
  });

  it("POST /api/runtime/threads creates thread", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-srv-test-"));
    const app = buildServer({ baseDir, llm: mockLlm, autoEnqueue: false, dev: false });
    const res = await app.handle(
      new Request("http://localhost/api/runtime/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "app-test-s1",
          calleeObjectId: "_builtin/supervisor",
          message: "hi",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threadId: string; sessionId: string };
    expect(body.sessionId).toBe("app-test-s1");
    expect(body.threadId).toMatch(/^thread_/);
    await app.worldRuntime.dispose();
    await rm(baseDir, { recursive: true, force: true });
  });

  it("auto-enqueue triggers LLM (mock) after thread creation", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-srv-autoenq-"));
    let calls = 0;
    const llm: LlmClient = {
      async generate() {
        calls++;
        return {
          provider: "claude",
          model: "mock",
          outputItems: [],
          text: "done",
          toolCalls: [],
        };
      },
    };
    const app = buildServer({ baseDir, llm, autoEnqueue: true, dev: false });
    const res = await app.handle(
      new Request("http://localhost/api/runtime/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "app-test-autoenq",
          calleeObjectId: "_builtin/supervisor",
          message: "hi",
        }),
      }),
    );
    expect(res.status).toBe(200);
    // wait for background enqueue
    await new Promise((r) => setTimeout(r, 250));
    expect(calls).toBeGreaterThan(0);
    await app.worldRuntime.dispose();
    await rm(baseDir, { recursive: true, force: true });
  });
});
