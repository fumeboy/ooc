/**
 * relation derive — 单元测试
 *
 * 覆盖 spec 2026-05-20 relation-window-design + 2026-05-25 R8-5:
 *   - deriveRelationWindow:为每个非 super peer 派生 RelationWindow,带
 *     selfLongTermBody/Exists + selfSessionBody/Exists 字段
 *     (R8-5 删 peer_readme/peerReadmePath: relation 只在 pools/flows;
 *      加 *Exists boolean 给 API caller 区分 lazy-create vs read-fail)
 *   - deriveRelationCompanionKnowledge:已废弃;返回 [](backward-compat shim)
 *
 * 矩阵:long_term × session 关键差分组合;super alias 跳过;多 peer;无 persistence。
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createStoneObject,
  createPoolObject,
  poolKnowledgeRelationFile,
  flowRelationFile,
  type PoolObjectRef,
  type FlowObjectRef,
} from "../../../persistable";
import { makeThread } from "../../../__tests__/make-thread";
import type { TalkWindow } from "../../../executable/windows/_shared/types";
import {
  deriveRelationWindow,
  deriveRelationCompanionKnowledge,
  deriveRelationKnowledge,
} from "../synthesizer";

const SELF = "alice";
const PEER = "critic";
const SID = "s1";

function talkTo(target: string, id = `w_talk_${target}`, createdAt = 1000): TalkWindow {
  return {
    id,
    type: "talk",
    parentWindowId: "root",
    title: `talk to ${target}`,
    status: "open",
    createdAt,
    target,
    conversationId: id,
  };
}

function selfThread(baseDir: string, windows: TalkWindow[]) {
  return makeThread({
    id: "t_root",
    persistence: { baseDir, sessionId: SID, objectId: SELF, threadId: "t_root" },
    extraWindows: windows,
    skipCreatorWindow: true,
  });
}

async function writeSessionRelation(ref: FlowObjectRef, peerId: string, content: string) {
  const file = flowRelationFile(ref, peerId);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, content, "utf8");
}

describe("deriveRelationWindow", () => {
  let tempRoot: string;
  let selfPoolRef: PoolObjectRef;
  let selfFlowRef: FlowObjectRef;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-relation-derive-"));
    selfPoolRef = { baseDir: tempRoot, objectId: SELF };
    selfFlowRef = { baseDir: tempRoot, sessionId: SID, objectId: SELF };
    // R8-5: relation derivation 不再读 peer stone readme; 但创建 stone 让 init.ts
    // 注入 creator window 等关联逻辑不至于撞 ENOENT
    await createStoneObject({ baseDir: tempRoot, objectId: SELF });
    await createStoneObject({ baseDir: tempRoot, objectId: PEER });
    await createPoolObject(selfPoolRef);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("每个非 super peer 派生 1 个 RelationWindow,id=w_rel_<peer>", async () => {
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationWindow(thread);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("relation");
    expect(out[0]!.peerId).toBe(PEER);
    expect(out[0]!.id).toBe(`w_rel_${PEER}`);
    expect(out[0]!.parentWindowId).toBe("root");
    expect(out[0]!.status).toBe("open");
    expect(out[0]!.title).toBe(`relation: ${PEER}`);
    // 路径字段:始终给出,不论文件是否存在
    // R8-5: peerReadmePath 已删除（relation 只在 pools/flows）
    expect(out[0]!.selfLongTermPath).toBe(`pools/${SELF}/knowledge/relations/${PEER}.md`);
    expect(out[0]!.selfSessionPath).toBe(`flows/${SID}/objects/${SELF}/knowledge/relations/${PEER}.md`);
    // R8-5: 新增 exists flag
    expect(out[0]!.selfLongTermExists).toBe(false);
    expect(out[0]!.selfSessionExists).toBe(false);
  });

  test("super alias 跳过:target='super' 不派生 RelationWindow", async () => {
    const thread = selfThread(tempRoot, [talkTo("super")]);
    const out = await deriveRelationWindow(thread);
    expect(out).toHaveLength(0);
  });

  test("同 peer 多 talk_window 去重为 1 个 RelationWindow", async () => {
    const thread = selfThread(tempRoot, [
      talkTo(PEER, "w_talk_critic_1"),
      talkTo(PEER, "w_talk_critic_2"),
    ]);
    const out = await deriveRelationWindow(thread);
    expect(out).toHaveLength(1);
    expect(out[0]!.peerId).toBe(PEER);
  });

  test("createdAt 取该 peer 最早的 talk_window.createdAt(stable across polls)", async () => {
    const thread = selfThread(tempRoot, [
      talkTo(PEER, "w_talk_critic_1", 5000),
      talkTo(PEER, "w_talk_critic_2", 1000),
      talkTo(PEER, "w_talk_critic_3", 3000),
    ]);
    const out = await deriveRelationWindow(thread);
    expect(out).toHaveLength(1);
    expect(out[0]!.createdAt).toBe(1000);
  });

  test("multi-peer:每个 peer 产出独立 RelationWindow", async () => {
    const thread = selfThread(tempRoot, [talkTo(PEER), talkTo("reviewer")]);
    const out = await deriveRelationWindow(thread);
    expect(out).toHaveLength(2);
    const ids = out.map((w) => w.id).sort();
    expect(ids).toEqual([`w_rel_${PEER}`, "w_rel_reviewer"]);
  });

  test("无 persistence:返回空", async () => {
    const thread = makeThread({
      id: "t_root",
      extraWindows: [talkTo(PEER)],
      skipCreatorWindow: true,
    });
    const out = await deriveRelationWindow(thread);
    expect(out).toHaveLength(0);
  });

  describe("body + exists fields(R8-5: 删 peer_readme; 加 *Exists flag)", () => {
    test("00: long_term 缺 + session 缺 → body undefined + exists=false", async () => {
      const thread = selfThread(tempRoot, [talkTo(PEER)]);
      const out = await deriveRelationWindow(thread);
      expect(out).toHaveLength(1);
      expect(out[0]!.selfLongTermBody).toBeUndefined();
      expect(out[0]!.selfLongTermExists).toBe(false);
      expect(out[0]!.selfSessionBody).toBeUndefined();
      expect(out[0]!.selfSessionExists).toBe(false);
    });

    test("long_term + session 都在 → 两个 body 含实际内容 + exists=true", async () => {
      await writeFile(poolKnowledgeRelationFile(selfPoolRef, PEER), "我对 critic 的长期认知", "utf8");
      await writeSessionRelation(selfFlowRef, PEER, "本 session 临时认知");
      const thread = selfThread(tempRoot, [talkTo(PEER)]);
      const out = await deriveRelationWindow(thread);
      expect(out[0]!.selfLongTermBody).toBe("我对 critic 的长期认知");
      expect(out[0]!.selfLongTermExists).toBe(true);
      expect(out[0]!.selfSessionBody).toBe("本 session 临时认知");
      expect(out[0]!.selfSessionExists).toBe(true);
    });

    test("仅 session 存在 → long_term undefined+exists=false, session 含内容+exists=true", async () => {
      await writeSessionRelation(selfFlowRef, PEER, "session-only 内容");
      const thread = selfThread(tempRoot, [talkTo(PEER)]);
      const out = await deriveRelationWindow(thread);
      expect(out[0]!.selfLongTermBody).toBeUndefined();
      expect(out[0]!.selfLongTermExists).toBe(false);
      expect(out[0]!.selfSessionBody).toBe("session-only 内容");
      expect(out[0]!.selfSessionExists).toBe(true);
    });

    test("multi-peer:每个 peer 的 body 字段独立", async () => {
      const reviewerPoolRef: PoolObjectRef = { baseDir: tempRoot, objectId: "reviewer" };
      await createPoolObject(reviewerPoolRef);
      // 写两个 peer 的 long_term 到 self 的 pool, 验证 multi-peer 不串台
      await writeFile(poolKnowledgeRelationFile(selfPoolRef, PEER), "对 critic 的认知", "utf8");
      await writeFile(poolKnowledgeRelationFile(selfPoolRef, "reviewer"), "对 reviewer 的认知", "utf8");
      const thread = selfThread(tempRoot, [talkTo(PEER), talkTo("reviewer")]);
      const out = await deriveRelationWindow(thread);
      const critic = out.find((w) => w.peerId === PEER)!;
      const reviewer = out.find((w) => w.peerId === "reviewer")!;
      expect(critic.selfLongTermBody).toBe("对 critic 的认知");
      expect(reviewer.selfLongTermBody).toBe("对 reviewer 的认知");
    });
  });
});

describe("deriveRelationCompanionKnowledge / deriveRelationKnowledge(已废弃 shim)", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-relation-derive-"));
    await createStoneObject({ baseDir: tempRoot, objectId: SELF });
    await createStoneObject({ baseDir: tempRoot, objectId: PEER });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("deriveRelationCompanionKnowledge 始终返回空数组", async () => {
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationCompanionKnowledge(thread);
    expect(out).toEqual([]);
  });

  test("deriveRelationKnowledge 始终返回空数组(老 alias)", async () => {
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationKnowledge(thread);
    expect(out).toEqual([]);
  });
});
