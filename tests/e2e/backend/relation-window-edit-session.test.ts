/**
 * S-relation — backend e2e: relations 自视切片中出现 peer + relation_note(scope=session) 落盘
 *
 * OOC-4 L6a：relation_window 已删；relations 改由 renderSelfView 的 `<self_view><relations>`
 * 自视切片每轮注入（src/thinkable/context/self-view.ts），写侧为 root.relation_note。
 *
 * 本测试不走真 LLM：用 Elysia in-process seedSession 建出 user → assistant 的会话，
 * 然后 buildContext 渲染 callee（assistant）thread，断言 `<self_view><relations>` 含
 * peer_id="user"（callee 与 caller=user 有 talks.json 路由）。再直接调 executeRelationNote
 * (scope=session) 验证 flow 层文件落盘。
 *
 * 这是一个轻量 e2e：覆盖"server 启动 + 真 session 创建 + 真 callee thread + relations
 * 切片渲染 + relation_note 落盘"这条路径，避免引入 LLM 依赖；详细 relation_note 路径在
 * src/executable/windows/__tests__/relation-window.test.ts 单测里覆盖。
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { buildServer } from "@src/app/server";
import { createPauseStore } from "@src/app/server/runtime/pause-store";
import { createJobManager } from "@src/app/server/runtime/job-manager";
import { readThread, flowRelationFile } from "@src/persistable";
import { buildContext } from "@src/thinkable/context";
import { executeRelationNote } from "@src/executable/windows/root/command.relation";
import type { MethodExecOutcome } from "@src/executable/windows/_shared/method-types";

const SID = "_test_relation_e2e";
const TARGET = "assistant";

describe("[e2e backend] relation-slice-and-note", () => {
  let baseDir: string | undefined;

  afterEach(() => {
    if (baseDir) {
      try {
        rmSync(baseDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      baseDir = undefined;
    }
  });

  it("seedSession + 后端无 LLM 渲染 <self_view><relations> 含 peer=user;relation_note(session) 落 flow 文件", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "ooc-e2e-rel-"));

    // seed: 写一个 assistant stone 让 talk-delivery 能找到 callee
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(baseDir, "stones", TARGET, "knowledge"), { recursive: true });
    writeFileSync(
      join(baseDir, "stones", TARGET, ".stone.json"),
      JSON.stringify({ objectId: TARGET, name: TARGET, createdAt: Date.now() }, null, 2),
      "utf8",
    );
    writeFileSync(join(baseDir, "stones", TARGET, "self.md"), "test assistant", "utf8");

    const pauseStore = createPauseStore();
    const jobManager = createJobManager();
    const app = buildServer({
      port: 0,
      baseDir,
      stonesBranch: "main",
      workerPollMs: 50,
      workerEnabled: false,
      workerMaxTicks: 10,
      pauseStore,
      jobManager,
    });

    // seed session via HTTP (in-process)
    const seedResp = await app.handle(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: SID,
          targetObjectId: TARGET,
          initialMessage: "hello assistant",
        }),
      }),
    );
    expect(seedResp.status).toBe(200);
    const seeded = (await seedResp.json()) as {
      sessionId: string;
      targetObjectId: string;
      targetThreadId: string;
    };

    // 读 callee thread，buildContext 渲染 <self_view><relations>：
    // callee=assistant 与 caller=user 有 talks.json 路由 → relations 切片含 peer_id="user"
    const calleeThread = await readThread(
      { baseDir: baseDir!, sessionId: seeded.sessionId, objectId: seeded.targetObjectId },
      seeded.targetThreadId,
    );
    expect(calleeThread).toBeDefined();

    const messages = await buildContext(calleeThread!);
    const xml = messages[0]!.content;
    expect(xml).toContain("<relations>");
    expect(xml).toContain('<relation peer_id="user">');

    // relation_note(scope=session) 落盘验证
    const outcome = (await executeRelationNote({
      thread: calleeThread!,
      args: { peer: "user", content: "## test session relation\n- 偏好简短\n", scope: "session" },
    })) as MethodExecOutcome;
    expect(outcome.ok).toBe(true);
    expect((outcome as { ok: true; result?: string }).result).toContain("session 层 relation");
    const filePath = flowRelationFile(
      { baseDir: baseDir!, sessionId: seeded.sessionId, objectId: seeded.targetObjectId },
      "user",
    );
    expect(existsSync(filePath)).toBe(true);
  }, 30_000);
});
