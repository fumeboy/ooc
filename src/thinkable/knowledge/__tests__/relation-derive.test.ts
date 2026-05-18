/**
 * deriveRelationKnowledge — 单元测试
 *
 * 4 种文件存在组合(readme × relation = 00 / 01 / 10 / 11),super alias 跳过,
 * 多 talk 同 peer 去重,多 peer,无 persistence。
 *
 * 覆盖 origin §6 验收第 2 / 4 / 5 / 7 条 与 plan U7 test scenarios。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createStoneObject,
  readmeFile,
  relationFile,
  type StoneObjectRef,
} from "../../../persistable";
import { makeThread } from "../../../__tests__/make-thread";
import type { TalkWindow } from "../../../executable/windows/types";
import { deriveRelationKnowledge } from "../synthesizer";

const SELF = "alice";
const PEER = "critic";

function talkTo(target: string, id = `w_talk_${target}`): TalkWindow {
  return {
    id,
    type: "talk",
    parentWindowId: "root",
    title: `talk to ${target}`,
    status: "open",
    createdAt: Date.now(),
    target,
    conversationId: id,
  };
}

function selfThread(baseDir: string, windows: TalkWindow[]) {
  return makeThread({
    id: "t_root",
    persistence: { baseDir, sessionId: "s1", objectId: SELF, threadId: "t_root" },
    extraWindows: windows,
    skipCreatorWindow: true,
  });
}

describe("deriveRelationKnowledge", () => {
  let tempRoot: string;
  let selfRef: StoneObjectRef;
  let peerRef: StoneObjectRef;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-relation-derive-"));
    selfRef = { baseDir: tempRoot, objectId: SELF };
    peerRef = { baseDir: tempRoot, objectId: PEER };
    await createStoneObject(selfRef);
    await createStoneObject(peerRef);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("00: readme 缺 + relation 缺 → 仅 1 条 relation 占位", async () => {
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationKnowledge(thread);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("relation");
    expect(out[0]!.id).toBe(`kn_rel_${PEER}_self`);
    expect(out[0]!.path).toBe(`stones/${SELF}/knowledge/relations/${PEER}.md`);
    expect(out[0]!.body).toContain(`暂无对 ${PEER}`);
    expect(out[0]!.body).toContain("write_file");
    expect(out[0]!.body).toContain(`stones/${SELF}/knowledge/relations/${PEER}.md`);
  });

  test("01: readme 缺 + relation 在 → 仅 1 条 relation full", async () => {
    await writeFile(relationFile(selfRef, PEER), "已知关系内容", "utf8");
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationKnowledge(thread);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(`kn_rel_${PEER}_self`);
    expect(out[0]!.body).toBe("已知关系内容");
  });

  test("10: readme 在 + relation 缺 → 2 条:readme full + relation 占位", async () => {
    await writeFile(readmeFile(peerRef), "peer 的自述", "utf8");
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationKnowledge(thread);
    expect(out).toHaveLength(2);
    const readme = out.find((w) => w.id === `kn_rel_${PEER}_readme`);
    const rel = out.find((w) => w.id === `kn_rel_${PEER}_self`);
    expect(readme).toBeDefined();
    expect(readme!.body).toBe("peer 的自述");
    expect(readme!.path).toBe(`stones/${PEER}/readme.md`);
    expect(rel).toBeDefined();
    expect(rel!.body).toContain(`暂无对 ${PEER}`);
  });

  test("11: readme 在 + relation 在 → 2 条都是 full", async () => {
    await writeFile(readmeFile(peerRef), "peer 的自述", "utf8");
    await writeFile(relationFile(selfRef, PEER), "我对 peer 的认知", "utf8");
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationKnowledge(thread);
    expect(out).toHaveLength(2);
    expect(out.find((w) => w.id === `kn_rel_${PEER}_readme`)!.body).toBe("peer 的自述");
    expect(out.find((w) => w.id === `kn_rel_${PEER}_self`)!.body).toBe("我对 peer 的认知");
  });

  test("super alias 跳过:target='super' 不生成任何 relation window", async () => {
    const thread = selfThread(tempRoot, [talkTo("super")]);
    const out = await deriveRelationKnowledge(thread);
    expect(out).toHaveLength(0);
  });

  test("同 peer 多 talk_window 去重", async () => {
    await writeFile(readmeFile(peerRef), "peer 的自述", "utf8");
    const thread = selfThread(tempRoot, [
      talkTo(PEER, "w_talk_critic_1"),
      talkTo(PEER, "w_talk_critic_2"),
    ]);
    const out = await deriveRelationKnowledge(thread);
    // 仍只生成 2 条(readme + relation 占位),按 peerId 去重
    expect(out).toHaveLength(2);
  });

  test("multi-peer:两个不同 peer 都有 readme,产出 4 条", async () => {
    const reviewerRef: StoneObjectRef = { baseDir: tempRoot, objectId: "reviewer" };
    await createStoneObject(reviewerRef);
    await writeFile(readmeFile(peerRef), "critic readme", "utf8");
    await writeFile(readmeFile(reviewerRef), "reviewer readme", "utf8");
    await writeFile(relationFile(selfRef, PEER), "我对 critic 的认知", "utf8");
    await writeFile(relationFile(selfRef, "reviewer"), "我对 reviewer 的认知", "utf8");
    const thread = selfThread(tempRoot, [talkTo(PEER), talkTo("reviewer")]);
    const out = await deriveRelationKnowledge(thread);
    expect(out).toHaveLength(4);
    const ids = out.map((w) => w.id).sort();
    expect(ids).toEqual([
      `kn_rel_${PEER}_readme`,
      `kn_rel_${PEER}_self`,
      `kn_rel_reviewer_readme`,
      `kn_rel_reviewer_self`,
    ]);
  });

  test("无 persistence:不报错,返回空数组", async () => {
    const thread = makeThread({
      id: "t_root",
      extraWindows: [talkTo(PEER)],
      skipCreatorWindow: true,
    });
    const out = await deriveRelationKnowledge(thread);
    expect(out).toHaveLength(0);
  });

  test("peer stones 目录不存在:跳过 readme,relation 仍生成占位", async () => {
    const thread = selfThread(tempRoot, [talkTo("nonexistent")]);
    const out = await deriveRelationKnowledge(thread);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(`kn_rel_nonexistent_self`);
    expect(out[0]!.body).toContain("暂无对 nonexistent");
  });

  test("所有 KnowledgeWindow 字段:source/presentation/parentWindowId/status 正确", async () => {
    await writeFile(readmeFile(peerRef), "x", "utf8");
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationKnowledge(thread);
    for (const w of out) {
      expect(w.type).toBe("knowledge");
      expect(w.source).toBe("relation");
      expect(w.status).toBe("open");
      expect(w.parentWindowId).toBe("root");
      expect(w.presentation).toBe("full");
    }
  });
});
