/**
 * relations 自视切片 — 单元测试（OOC-4 L6a：relation_window 删除 → 自动注入）
 *
 * 旧 deriveRelationWindow（按 talk_window 派生 RelationWindow）已删；relations 改由
 * renderSelfView 的 `<relations>` 切片每轮注入（src/thinkable/context/self-view.ts:
 * renderRelationsSlice）。本测试覆盖：
 *   - peer 集 = discoverStoneHierarchicalPeers（siblings/children）∪ talks.json peers。
 *   - 每 peer 渲染 peer_readme（peer readable.md）+ self_long_term（pools relations）
 *     + self_session（flows relations），exists 才渲。
 *   - 无任何 peer → 不渲 `<relations>`；nil-persistence → renderSelfView 返回 null。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createStoneObject,
  createPoolObject,
  createFlowObject,
  poolKnowledgeRelationFile,
  writeFlowRelation,
  writeReadable,
  setTalkRoute,
  type PoolObjectRef,
  type FlowObjectRef,
} from "../../../persistable";
import { makeThread } from "../../../__tests__/make-thread";
import { renderSelfView } from "../../context/self-view";
import { serializeXml } from "../../context/xml";

const SELF = "alice";
const SID = "s1";

async function selfViewXml(baseDir: string): Promise<string | null> {
  const thread = makeThread({
    id: "t_root",
    persistence: { baseDir, sessionId: SID, objectId: SELF, threadId: "t_root" },
    skipCreatorWindow: true,
  });
  const node = await renderSelfView(thread);
  return node ? serializeXml(node) : null;
}

describe("renderSelfView <relations> 切片", () => {
  let tempRoot: string;
  let selfPoolRef: PoolObjectRef;
  let selfFlowRef: FlowObjectRef;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-relations-slice-"));
    selfPoolRef = { baseDir: tempRoot, objectId: SELF };
    selfFlowRef = { baseDir: tempRoot, sessionId: SID, objectId: SELF };
    await createStoneObject({ baseDir: tempRoot, objectId: SELF });
    await createPoolObject(selfPoolRef);
    await createFlowObject({ baseDir: tempRoot, sessionId: SID, objectId: SELF });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("无任何 peer（无 sibling/child、无 talks.json） → 不渲 <relations>", async () => {
    const xml = await selfViewXml(tempRoot);
    // 无 plan/todos/talks/relations → renderSelfView 整体返回 null
    expect(xml).toBeNull();
  });

  test("同级 sibling stone 自动进 relations 切片", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
    const xml = await selfViewXml(tempRoot);
    expect(xml).not.toBeNull();
    expect(xml).toContain("<relations>");
    expect(xml).toContain('<relation peer_id="bob">');
  });

  test("一级 children stone 自动进 relations 切片；深层不递归", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: `${SELF}/sub1` });
    await createStoneObject({ baseDir: tempRoot, objectId: `${SELF}/sub1/grand` });
    const xml = await selfViewXml(tempRoot);
    expect(xml).toContain(`<relation peer_id="${SELF}/sub1">`);
    expect(xml).not.toContain("grand");
  });

  test("talks.json peer（含 user）自动进 relations 切片，即便不是 sibling/child", async () => {
    // user 不是 Agent stone，但与之 talk 过 → 应进 relations
    await setTalkRoute(selfFlowRef, "user", { conversationId: "conv_user_1", targetThreadId: "t_user" });
    const xml = await selfViewXml(tempRoot);
    expect(xml).toContain('<relation peer_id="user">');
  });

  test("super alias 不计入 relations（talks.json['super'] 跳过）", async () => {
    await setTalkRoute(selfFlowRef, "super", { conversationId: "conv_super_1" });
    const xml = await selfViewXml(tempRoot);
    // 只有 super 路由、无其它 peer → 不渲 relations
    expect(xml).toBeNull();
  });

  test("siblings/children ∪ talks.json peers 并集去重", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
    await setTalkRoute(selfFlowRef, "bob", { conversationId: "conv_bob" });
    await setTalkRoute(selfFlowRef, "critic", { conversationId: "conv_critic" });
    const xml = await selfViewXml(tempRoot);
    // bob 既是 sibling 又有 talk 路由 → 只出现一次
    expect(xml!.match(/<relation peer_id="bob">/g)?.length).toBe(1);
    expect(xml).toContain('<relation peer_id="critic">');
  });

  test("peer readable.md 有内容 → 渲 peer_readme", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
    await writeReadable({ baseDir: tempRoot, objectId: "bob" }, "## bob\n是个评审 Agent");
    const xml = await selfViewXml(tempRoot);
    expect(xml).toContain("<peer_readme");
    expect(xml).toContain("是个评审 Agent");
  });

  test("peer 无 readable / 空 readable → 不渲 peer_readme", async () => {
    // createStoneObject 默认写空 readable.md
    await createStoneObject({ baseDir: tempRoot, objectId: "empty" });
    const xml = await selfViewXml(tempRoot);
    expect(xml).toContain('<relation peer_id="empty">');
    expect(xml).not.toContain("<peer_readme");
  });

  test("self_long_term + self_session 都存在 → 两段都渲", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: "critic" });
    await writeFile(poolKnowledgeRelationFile(selfPoolRef, "critic"), "我对 critic 的长期认知", "utf8");
    await writeFlowRelation(selfFlowRef, "critic", "本 session 临时认知");
    const xml = await selfViewXml(tempRoot);
    expect(xml).toContain("<self_long_term");
    expect(xml).toContain("我对 critic 的长期认知");
    expect(xml).toContain("<self_session");
    expect(xml).toContain("本 session 临时认知");
  });

  test("仅 session relation 存在 → 渲 self_session，不渲 self_long_term", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: "critic" });
    await writeFlowRelation(selfFlowRef, "critic", "session-only 内容");
    const xml = await selfViewXml(tempRoot);
    expect(xml).toContain("<self_session");
    expect(xml).toContain("session-only 内容");
    expect(xml).not.toContain("<self_long_term");
  });

  test("multi-peer：各 peer 的 relation 文件独立不串台", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: "critic" });
    await createStoneObject({ baseDir: tempRoot, objectId: "reviewer" });
    await writeFile(poolKnowledgeRelationFile(selfPoolRef, "critic"), "对 critic 的认知", "utf8");
    await writeFile(poolKnowledgeRelationFile(selfPoolRef, "reviewer"), "对 reviewer 的认知", "utf8");
    const xml = await selfViewXml(tempRoot);
    expect(xml).toContain("对 critic 的认知");
    expect(xml).toContain("对 reviewer 的认知");
  });

  test("self 不计入自身 relations（self 不与自己建关系）", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
    const xml = await selfViewXml(tempRoot);
    expect(xml).not.toContain(`<relation peer_id="${SELF}">`);
  });

  test("nil-persistence（无 objectId）→ renderSelfView 返回 null", async () => {
    const thread = makeThread({ id: "t_root", skipCreatorWindow: true });
    const node = await renderSelfView(thread);
    expect(node).toBeNull();
  });
});
