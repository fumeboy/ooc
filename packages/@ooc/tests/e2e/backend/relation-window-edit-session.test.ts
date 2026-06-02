/**
 * S-relation — backend e2e: relation_window 在 contextSnapshot 中出现 + edit(scope=session) 落盘
 *
 * 不走真 LLM:用 Elysia in-process seedSession 建出 user → assistant 的 talk_window,
 * 然后直接调 collectExecutableKnowledgeEntries 验证 callee thread 的 contextSnapshot
 * 包含 RelationWindow。再直接调 executeRelationEdit 验证 session 层文件落盘。
 *
 * 这是一个轻量 e2e:覆盖"server 启动 + 真 session 创建 + 真 callee thread"这条路径,
 * 但避免引入 LLM 依赖与漫长等待;详细 edit 路径在 src/executable/windows/__tests__/
 * relation-window.test.ts 单测里覆盖。
 *
 * 详见 plan witty-bubbling-pebble.md § 测试 / 验证 与 docs/testing/strategy.md。
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { buildServer } from "@ooc/core/app/server";
import { createPauseStore } from "@ooc/core/app/server/runtime/pause-store";
import { createJobManager } from "@ooc/core/app/server/runtime/job-manager";
import { readThread, flowRelationFile } from "@ooc/core/persistable";
import { collectExecutableKnowledgeEntries } from "@ooc/core/thinkable/knowledge/synthesizer";
import { executeRelationEdit } from "@ooc/core/executable/windows/relation";
import type { RelationWindow } from "@ooc/core/executable/windows/_shared/types";

const SID = "_test_relation_e2e";
const TARGET = "assistant";

describe("[e2e backend] relation-window-edit-session", () => {
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

  it("seedSession + 后端无 LLM 派生 contextSnapshot 包含 RelationWindow;edit(session) 落到 flow 文件", async () => {
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

    // 读 callee thread,验证 contextSnapshot 中含 RelationWindow(peerId 是 user,
    // 因为 callee 创建时初始 creator talk_window 指向 caller=user)
    const calleeThread = await readThread(
      { baseDir: baseDir!, sessionId: seeded.sessionId, objectId: seeded.targetObjectId },
      seeded.targetThreadId,
    );
    expect(calleeThread).toBeDefined();

    const snapshot = await collectExecutableKnowledgeEntries(
      calleeThread!.contextWindows,
      calleeThread!,
    );
    const relationWindows = (snapshot.contextWindows ?? []).filter(
      (w): w is RelationWindow => w.type === "relation",
    );
    expect(relationWindows.length).toBeGreaterThan(0);
    // callee 是 assistant,初始 creator talk_window target = user → relation 派生 peerId=user
    const userRel = relationWindows.find((w) => w.peerId === "user");
    expect(userRel).toBeDefined();
    expect(userRel!.id).toBe("w_rel_user");
    expect(userRel!.status).toBe("open");

    // edit(scope=session) 落盘验证
    const editResult = await executeRelationEdit({
      thread: calleeThread!,
      parentWindow: userRel!,
      self: userRel!,
      args: { content: "## test session relation\n- 偏好简短\n", scope: "session" },
    });
    expect(typeof editResult).toBe("string");
    expect(editResult).toContain("session 层 relation");
    const filePath = flowRelationFile(
      { baseDir: baseDir!, sessionId: seeded.sessionId, objectId: seeded.targetObjectId },
      "user",
    );
    expect(existsSync(filePath)).toBe(true);
  }, 30_000);
});
