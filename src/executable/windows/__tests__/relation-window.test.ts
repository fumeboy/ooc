/**
 * root.relation_note — 单元测试（OOC-4 L6a：relation_window 删除 → root 方法）
 *
 * 旧 relation_window.edit（window 方法）已删；relation_note 是 root 方法，参数
 * (peer, content, scope)：
 *   - scope="session"   → 直接写 flow 层 relation 文件
 *   - scope="long_term" → window-free deliverMessage 派 super（新建 / 复用 super 会话路由）
 *   - 缺省 scope 视为 session
 *   - 参数校验失败 → 返回 { ok: false, error } 而不 throw
 *
 * 复用 talk-delivery 的 fixture 风格（真 fs / 真 deliverMessage）。
 */
import { mkdtemp, readFile as fsReadFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import {
  createFlowObject,
  createFlowSession,
  createStoneObject,
  flowRelationFile,
  writeThread,
} from "../../../persistable";
import { executeRelationNote } from "../root/command.relation";
import { SUPER_SESSION_ID } from "../_shared/super-constants";
import { initContextWindows } from "../_shared/init";
import type { ThreadContext } from "../../../thinkable/context";
import type { MethodExecutionContext, MethodExecOutcome } from "../_shared/method-types";

const SELF = "alice";
const PEER = "critic";
const SID = "web-test";

async function setupSelfThread(baseDir: string) {
  await createFlowSession(baseDir, SID);
  await createStoneObject({ baseDir, objectId: SELF });
  await createStoneObject({ baseDir, objectId: PEER });
  const flow = await createFlowObject({ baseDir, sessionId: SID, objectId: SELF });
  const thread: ThreadContext = {
    id: "t_root",
    status: "running",
    events: [],
    contextWindows: [],
    persistence: { ...flow, threadId: "t_root" },
  };
  initContextWindows(thread, { initialTaskTitle: "test self" });
  await writeThread(thread);
  return { thread };
}

function execCtx(thread: ThreadContext, args: Record<string, unknown>): MethodExecutionContext {
  return { thread, args };
}

/** outcome 必须是成功；返回 result 文本。 */
function expectOk(outcome: MethodExecOutcome): string {
  expect(outcome.ok).toBe(true);
  return (outcome as { ok: true; result?: string }).result ?? "";
}

/** outcome 必须是失败；返回 error 文本。 */
function expectErr(outcome: MethodExecOutcome): string {
  expect(outcome.ok).toBe(false);
  return (outcome as { ok: false; error: string }).error;
}

describe("executeRelationNote", () => {
  it("scope='session' → 写入 flow 层 relation 文件", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-note-"));
    try {
      const { thread } = await setupSelfThread(tempRoot);
      const content = "## 偏好\n- 简短回复\n";
      const result = expectOk(
        (await executeRelationNote(execCtx(thread, { peer: PEER, content, scope: "session" }))) as MethodExecOutcome,
      );
      expect(result).toContain("session 层 relation");
      const file = flowRelationFile({ baseDir: tempRoot, sessionId: SID, objectId: SELF }, PEER);
      expect(existsSync(file)).toBe(true);
      const written = await fsReadFile(file, "utf8");
      expect(written).toBe(content);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("缺省 scope → 视为 session（落 flow 文件）", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-note-"));
    try {
      const { thread } = await setupSelfThread(tempRoot);
      const result = expectOk(
        (await executeRelationNote(execCtx(thread, { peer: PEER, content: "默认 session" }))) as MethodExecOutcome,
      );
      expect(result).toContain("session 层 relation");
      const file = flowRelationFile({ baseDir: tempRoot, sessionId: SID, objectId: SELF }, PEER);
      expect(existsSync(file)).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scope='long_term' → 派 super flow：创建 super session + callee + caller.outbox 多出消息", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-note-"));
    try {
      const { thread } = await setupSelfThread(tempRoot);
      const outboxBefore = thread.outbox?.length ?? 0;
      const content = "稳定合作模式:简短 / 不要 emoji";
      const result = expectOk(
        (await executeRelationNote(execCtx(thread, { peer: PEER, content, scope: "long_term" }))) as MethodExecOutcome,
      );
      expect(result).toContain("long_term");
      expect(result).toContain("super flow");
      // caller outbox 多了一条
      expect(thread.outbox?.length ?? 0).toBe(outboxBefore + 1);
      const sentMsg = thread.outbox![thread.outbox!.length - 1]!;
      expect(sentMsg.content).toContain(PEER);
      expect(sentMsg.content).toContain(content);
      // super session metadata 已创建
      expect(existsSync(join(tempRoot, "flows", SUPER_SESSION_ID, ".session.json"))).toBe(true);
      // super flow 的 callee 目录已创建
      const superSelfDir = join(tempRoot, "flows", SUPER_SESSION_ID, "objects", SELF, "threads");
      expect(existsSync(superSelfDir)).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("缺 peer → 返回 error outcome,不 throw", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-note-"));
    try {
      const { thread } = await setupSelfThread(tempRoot);
      const err = expectErr(
        (await executeRelationNote(execCtx(thread, { content: "x", scope: "session" }))) as MethodExecOutcome,
      );
      expect(err).toContain("[relation_note]");
      expect(err).toContain("peer");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("缺 content → 返回 error outcome", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-note-"));
    try {
      const { thread } = await setupSelfThread(tempRoot);
      const err = expectErr(
        (await executeRelationNote(execCtx(thread, { peer: PEER, scope: "session" }))) as MethodExecOutcome,
      );
      expect(err).toContain("content");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("非法 scope → 返回 error outcome", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-note-"));
    try {
      const { thread } = await setupSelfThread(tempRoot);
      const err = expectErr(
        (await executeRelationNote(execCtx(thread, { peer: PEER, content: "x", scope: "invalid" }))) as MethodExecOutcome,
      );
      expect(err).toContain("scope");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("nil-persistence（无 thread.persistence）→ 返回成功说明文本,不落盘", async () => {
    const outcome = (await executeRelationNote({
      args: { peer: PEER, content: "x", scope: "session" },
    })) as MethodExecOutcome;
    const result = expectOk(outcome);
    expect(result).toContain("内存模式");
  });
});
