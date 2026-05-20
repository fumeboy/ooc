/**
 * relation derive — 单元测试
 *
 * 覆盖 spec 2026-05-20 relation-window 升级后:
 *   - deriveRelationWindow:为每个非 super peer 派生 RelationWindow
 *   - deriveRelationCompanionKnowledge:伴随 KnowledgeWindow(双层 body)
 *
 * 矩阵:readme × long_term × session 关键差分组合;super alias 跳过;多 peer;无 persistence。
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createStoneObject,
  readmeFile,
  relationFile,
  flowRelationFile,
  type StoneObjectRef,
  type FlowObjectRef,
} from "../../../persistable";
import { makeThread } from "../../../__tests__/make-thread";
import type { TalkWindow } from "../../../executable/windows/types";
import {
  deriveRelationWindow,
  deriveRelationCompanionKnowledge,
  deriveRelationKnowledge,
} from "../synthesizer";

const SELF = "alice";
const PEER = "critic";
const SID = "s1";

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
});

describe("deriveRelationCompanionKnowledge", () => {
  let tempRoot: string;
  let selfRef: StoneObjectRef;
  let peerRef: StoneObjectRef;
  let selfFlowRef: FlowObjectRef;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-relation-derive-"));
    selfRef = { baseDir: tempRoot, objectId: SELF };
    peerRef = { baseDir: tempRoot, objectId: PEER };
    selfFlowRef = { baseDir: tempRoot, sessionId: SID, objectId: SELF };
    await createStoneObject(selfRef);
    await createStoneObject(peerRef);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("00: readme 缺 + long_term 缺 + session 缺 → 1 条 self(双层占位)", async () => {
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationCompanionKnowledge(thread);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("relation");
    expect(out[0]!.id).toBe(`kn_rel_${PEER}_self`);
    expect(out[0]!.path).toBe(`stones/${SELF}/knowledge/relations/${PEER}.md`);
    expect(out[0]!.body).toContain("## long_term");
    expect(out[0]!.body).toContain("## session");
    expect(out[0]!.body).toContain("scope: \"long_term\"");
    expect(out[0]!.body).toContain("scope: \"session\"");
  });

  test("long_term 在 + session 在 → body 含两段实际内容", async () => {
    await writeFile(relationFile(selfRef, PEER), "我对 critic 的长期认知", "utf8");
    await writeSessionRelation(selfFlowRef, PEER, "本 session 临时认知");
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationCompanionKnowledge(thread);
    const self = out.find((w) => w.id === `kn_rel_${PEER}_self`)!;
    expect(self).toBeDefined();
    expect(self.body).toContain("## long_term");
    expect(self.body).toContain("我对 critic 的长期认知");
    expect(self.body).toContain("## session");
    expect(self.body).toContain("本 session 临时认知");
  });

  test("仅 session 存在 → long_term 段显占位 + session 段显内容", async () => {
    await writeSessionRelation(selfFlowRef, PEER, "session-only 内容");
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationCompanionKnowledge(thread);
    const self = out.find((w) => w.id === `kn_rel_${PEER}_self`)!;
    const body = self.body ?? "";
    expect(body).toContain("session-only 内容");
    // long_term 段是占位
    const longTermIdx = body.indexOf("## long_term");
    const sessionIdx = body.indexOf("## session");
    const longTermSection = body.slice(longTermIdx, sessionIdx);
    expect(longTermSection).toContain("scope: \"long_term\"");
  });

  test("readme 在 + double 缺 → readme full + self 占位双层", async () => {
    await writeFile(readmeFile(peerRef), "peer 的自述", "utf8");
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationCompanionKnowledge(thread);
    expect(out).toHaveLength(2);
    const readme = out.find((w) => w.id === `kn_rel_${PEER}_readme`)!;
    expect(readme.body).toBe("peer 的自述");
    expect(readme.path).toBe(`stones/${PEER}/readme.md`);
    const self = out.find((w) => w.id === `kn_rel_${PEER}_self`)!;
    expect(self.body).toContain("## long_term");
    expect(self.body).toContain("## session");
  });

  test("super alias 跳过 companion knowledge", async () => {
    const thread = selfThread(tempRoot, [talkTo("super")]);
    const out = await deriveRelationCompanionKnowledge(thread);
    expect(out).toHaveLength(0);
  });

  test("multi-peer:每个 peer 输出 self 条;有 readme 的额外 readme 条", async () => {
    const reviewerRef: StoneObjectRef = { baseDir: tempRoot, objectId: "reviewer" };
    await createStoneObject(reviewerRef);
    await writeFile(readmeFile(peerRef), "critic readme", "utf8");
    await writeFile(readmeFile(reviewerRef), "reviewer readme", "utf8");
    const thread = selfThread(tempRoot, [talkTo(PEER), talkTo("reviewer")]);
    const out = await deriveRelationCompanionKnowledge(thread);
    expect(out).toHaveLength(4);
    const ids = out.map((w) => w.id).sort();
    expect(ids).toEqual([
      `kn_rel_${PEER}_readme`,
      `kn_rel_${PEER}_self`,
      "kn_rel_reviewer_readme",
      "kn_rel_reviewer_self",
    ]);
  });

  test("无 persistence:返回空", async () => {
    const thread = makeThread({
      id: "t_root",
      extraWindows: [talkTo(PEER)],
      skipCreatorWindow: true,
    });
    const out = await deriveRelationCompanionKnowledge(thread);
    expect(out).toHaveLength(0);
  });

  test("所有 KnowledgeWindow 字段:source/presentation/parentWindowId/status 正确", async () => {
    await writeFile(readmeFile(peerRef), "x", "utf8");
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationCompanionKnowledge(thread);
    for (const w of out) {
      expect(w.type).toBe("knowledge");
      expect(w.source).toBe("relation");
      expect(w.status).toBe("open");
      expect(w.parentWindowId).toBe("root");
      expect(w.presentation).toBe("full");
    }
  });
});

describe("deriveRelationKnowledge (backward-compat alias)", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-relation-derive-"));
    await createStoneObject({ baseDir: tempRoot, objectId: SELF });
    await createStoneObject({ baseDir: tempRoot, objectId: PEER });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("旧 API 仍返回伴随 KnowledgeWindow", async () => {
    const thread = selfThread(tempRoot, [talkTo(PEER)]);
    const out = await deriveRelationKnowledge(thread);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((w) => w.type === "knowledge" && w.source === "relation")).toBe(true);
  });
});
