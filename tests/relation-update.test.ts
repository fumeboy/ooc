/**
 * relation_update 机制单测（Phase 6）
 *
 * 覆盖：
 * - ThreadsTree.writeInbox 能透传 kind 字段
 * - ThreadInboxMessage.kind 默认空（不污染老消息）
 * - talkable/relation_update TRAIT.md 的 frontmatter 能被 loader 识别
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ThreadsTree } from "../src/thread/tree.js";
import { loadTrait } from "../src/trait/loader.js";

const TMP_ROOT = "/tmp/ooc-relation-update-test";

beforeEach(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
  mkdirSync(TMP_ROOT, { recursive: true });
});
afterEach(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

describe("ThreadsTree.writeInbox — kind 透传", () => {
  test("写入 kind=relation_update_request 后可在 inbox 读出", async () => {
    const dir = join(TMP_ROOT, "flow");
    const tree = await ThreadsTree.create(dir, "root", "desc");
    tree.writeInbox(tree.rootId, {
      from: "kernel",
      content: "请在你的 relations/kernel.md 里登记...",
      source: "talk",
      kind: "relation_update_request",
    });
    const data = tree.readThreadData(tree.rootId);
    expect(data?.inbox?.length).toBeGreaterThan(0);
    const last = data!.inbox![data!.inbox!.length - 1]!;
    expect(last.kind).toBe("relation_update_request");
    expect(last.from).toBe("kernel");
    expect(last.status).toBe("unread");
  });

  test("不传 kind 时老行为不变（kind=undefined）", async () => {
    const dir = join(TMP_ROOT, "flow");
    const tree = await ThreadsTree.create(dir, "root", "desc");
    tree.writeInbox(tree.rootId, {
      from: "user",
      content: "hello",
      source: "talk",
    });
    const data = tree.readThreadData(tree.rootId);
    const last = data!.inbox![data!.inbox!.length - 1]!;
    expect(last.kind).toBeUndefined();
  });
});

describe("talkable/relation_update TRAIT.md", () => {
  test("TRAIT.md 存在且可被 loader 解析", async () => {
    const traitDir = "/Users/zhangzhefu/x/ooc/user/kernel/traits/talkable/relation_update";
    expect(existsSync(join(traitDir, "TRAIT.md"))).toBe(true);
    const trait = await loadTrait(traitDir, "kernel");
    expect(trait).not.toBeNull();
    expect(trait!.namespace).toBe("kernel");
    expect(trait!.name).toBe("talkable/relation_update");
    expect(trait!.activatesOn?.paths).toEqual(["talk.continue.relation_update"]);
  });

  test("TRAIT.md 正文包含关键段落（发起方 / 接收方指导）", () => {
    const traitDir = "/Users/zhangzhefu/x/ooc/user/kernel/traits/talkable/relation_update";
    const content = readFileSync(join(traitDir, "TRAIT.md"), "utf-8");
    expect(content).toContain("发起方");
    expect(content).toContain("接收方");
    expect(content).toContain("type=relation_update");
  });
});
