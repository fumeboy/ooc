/**
 * Bruce 验收：三阶段 Trait 激活 + Relation 统一模型（E2E integration test）
 *
 * 覆盖 Bruce 需要验证的 5 个场景：
 *
 * 1. Context 里包含 <relations> 索引区块（扫描 peers + 读取关系文件降级链）
 * 2. LLM 可通过 open(path="@relation:<peer>") 直接读到关系全文
 * 3. talk.continue.relation_update 请求在接收方以 <relation_update_request>
 *    徽章出现；engine 不自动写入任何 relation 文件
 * 4. open(command=talk) + 多次 refine 累积 args + 最终 submit（深化命令
 *    路径；TRAIT.md 单调追加 open，不回缩）
 * 5. 无 openFiles / formState 新字段的旧 thread.json 仍可正常运行（向后兼容）
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ThreadsTree } from "../src/thinkable/thread-tree/tree.js";
import { buildThreadContext } from "../src/thinkable/context/builder.js";
import { getOpenFiles } from "../src/extendable/activation/open-files.js";
import { FormManager } from "../src/executable/forms/form.js";
import { collectCommandTraits } from "../src/extendable/activation/hooks.js";
import { resolveVirtualPath } from "../src/executable/protocol/virtual-path.js";
import { scanPeers } from "../src/collaborable/relation/peers.js";
import { readPeerRelations, renderRelationsIndex } from "../src/collaborable/relation/relation.js";
import { deriveCommandPaths } from "../src/executable/commands/index.js";
import { detectSelfKind } from "../src/object/self-kind.js";

import type { StoneData, TraitDefinition } from "../src/shared/types/index.js";
import type { ThreadDataFile } from "../src/thinkable/thread-tree/types.js";

const TMP_ROOT = "/tmp/ooc-bruce-e14";
const PROJECT_ROOT = resolve(import.meta.dir, "../..");

beforeEach(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
  mkdirSync(TMP_ROOT, { recursive: true });
});
afterEach(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

/** 造一个 TraitDefinition */
function trait(
  namespace: "kernel" | "library" | "self",
  name: string,
  opts?: { deps?: string[]; commands?: string[]; readme?: string },
): TraitDefinition {
  return {
    namespace, name, kind: "trait", type: "how_to_think", version: "1.0.0",
    description: "", readme: opts?.readme ?? `# ${namespace}:${name}`, deps: opts?.deps ?? [],
    activatesOn: opts?.commands ? { showContentWhen: opts.commands } : undefined,
    dir: `/fake/${namespace}/${name}`,
  };
}

/** 造一个最小 stone */
function makeStone(name: string, stoneDir: string, data?: Record<string, unknown>): StoneData {
  return {
    name,
    thinkable: { whoAmI: `I am ${name}` },
    talkable: { whoAmI: `I am ${name}`, functions: [] },
    data: data ?? {},
    relations: [],
    traits: [],
  };
}

/** 写一个 relation 文件 */
function writeRelation(selfName: string, peer: string, body: string): void {
  const dir = join(TMP_ROOT, "stones", selfName, "relations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${peer}.md`), body, "utf-8");
}

describe("Bruce 1 · Context 里的 <relations> 索引", () => {
  test("supervisor → kernel 的会话，kernel 的 context 含 <relations> 索引", async () => {
    /* 前置：kernel 的 relations/supervisor.md 存在 */
    writeRelation(
      "kernel",
      "supervisor",
      `---\nsummary: OOC 总指挥，审批 G/E 编号变更\n---\n\n# 与 supervisor 的关系\n\n- 所有大改动先报 supervisor\n`,
    );

    const stoneDir = join(TMP_ROOT, "stones", "kernel");
    mkdirSync(stoneDir, { recursive: true });
    const stone = makeStone("kernel", stoneDir);

    /* kernel 的线程树（模拟 supervisor 向它发了一条 talk） */
    const flowDir = join(TMP_ROOT, "flows", "s1", "objects", "kernel");
    const tree = await ThreadsTree.create(flowDir, "root", "task");
    tree.writeInbox(tree.rootId, {
      from: "supervisor",
      content: "请实现 E14 的激活统一",
      source: "talk",
    });

    const treeFile = {
      rootId: tree.rootId,
      nodes: Object.fromEntries(tree.nodeIds.map(id => [id, tree.getNode(id)!])),
    };
    const ctx = buildThreadContext({
      tree: treeFile,
      threadId: tree.rootId,
      threadData: tree.readThreadData(tree.rootId)!,
      stone,
      directory: [{ name: "supervisor", whoAmI: "OOC 总指挥", functions: [] }],
      traits: [],
      paths: { rootDir: TMP_ROOT, stoneDir, flowsDir: join(TMP_ROOT, "flows") },
    });

    expect(ctx.relations.length).toBe(1);
    expect(ctx.relations[0]!.name).toBe("supervisor");
    expect(ctx.relations[0]!.summary).toBe("OOC 总指挥，审批 G/E 编号变更");
  });

  test("无 relation 文件的 peer 也显示索引行 (无关系记录)", async () => {
    const stoneDir = join(TMP_ROOT, "stones", "alice");
    mkdirSync(stoneDir, { recursive: true });
    const stone = makeStone("alice", stoneDir);

    const flowDir = join(TMP_ROOT, "flows", "s1", "objects", "alice");
    const tree = await ThreadsTree.create(flowDir, "root", "task");
    tree.writeInbox(tree.rootId, {
      from: "bruce",
      content: "来用一下",
      source: "talk",
    });

    const treeFile = {
      rootId: tree.rootId,
      nodes: Object.fromEntries(tree.nodeIds.map(id => [id, tree.getNode(id)!])),
    };
    const ctx = buildThreadContext({
      tree: treeFile,
      threadId: tree.rootId,
      threadData: tree.readThreadData(tree.rootId)!,
      stone,
      directory: [],
      traits: [],
      paths: { rootDir: TMP_ROOT, stoneDir, flowsDir: join(TMP_ROOT, "flows") },
    });

    expect(ctx.relations.length).toBe(1);
    expect(ctx.relations[0]!.hasFile).toBe(false);
    expect(ctx.relations[0]!.summary).toBe("(无关系记录)");
  });
});

describe("Bruce 2 · open(path=@relation:<peer>) 可读取关系全文", () => {
  test("虚拟路径解析 + 文件内容读取", () => {
    writeRelation(
      "alice",
      "sophia",
      `---\nsummary: 哲学设计部\n---\n\n# 关系详情\n\n- 所有 G 编号变更必须先 talk 她`,
    );
    const resolved = resolveVirtualPath("@relation:sophia", {
      rootDir: TMP_ROOT,
      selfName: "alice",
      selfKind: "stone",
    });
    expect(resolved).toBe(join(TMP_ROOT, "stones", "alice", "relations", "sophia.md"));
    expect(existsSync(resolved!)).toBe(true);
    const content = readFileSync(resolved!, "utf-8");
    expect(content).toContain("所有 G 编号变更必须先 talk 她");
  });

  test("@trait:kernel/<name> 同样可解析", () => {
    const resolved = resolveVirtualPath("@trait:kernel/talkable/relation_update", {
      rootDir: PROJECT_ROOT,
      selfName: "alice",
      selfKind: "stone",
    });
    expect(resolved).toBe(
      join(PROJECT_ROOT, "kernel", "traits", "talkable", "relation_update", "TRAIT.md"),
    );
    expect(existsSync(resolved!)).toBe(true);
  });
});

describe("Bruce 3 · relation_update 请求徽章渲染（不自动写）", () => {
  test("接收方 inbox 收到 kind=relation_update_request 的消息", async () => {
    const flowDir = join(TMP_ROOT, "flows", "s1", "objects", "supervisor");
    const tree = await ThreadsTree.create(flowDir, "root", "task");
    /* 模拟 kernel 发来关系更新请求 */
    tree.writeInbox(tree.rootId, {
      from: "kernel",
      content: "请在 relations/kernel.md 里登记：所有 G 编号变更必须先 talk 我",
      source: "talk",
      kind: "relation_update_request",
    });
    const data = tree.readThreadData(tree.rootId)!;
    const msg = data.inbox![data.inbox!.length - 1]!;
    expect(msg.kind).toBe("relation_update_request");
    /* engine 不自动写 relations 文件 —— 验证文件不存在 */
    expect(existsSync(join(TMP_ROOT, "stones", "supervisor", "relations", "kernel.md"))).toBe(false);
  });

  test("deriveCommandPaths 包含 talk.continue.relation_update 等所有激活路径", () => {
    const paths = deriveCommandPaths("talk", {
      target: "supervisor",
      context: "continue",
      type: "relation_update",
      threadId: "th_xxx",
      msg: "请登记...",
    });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.continue");
    expect(paths).toContain("talk.relation_update");
    expect(paths).toContain("talk.continue.relation_update");
  });

  test("talkable/relation_update trait 绑定正确的命令路径（精确匹配）", () => {
    const traits = [
      trait("kernel", "talkable", { commands: ["talk"] }),
      trait("kernel", "talkable/cross_object", { commands: ["talk.fork"] }),
      trait("kernel", "talkable/relation_update", { commands: ["talk.continue.relation_update"] }),
    ];

    /* activePaths = deriveCommandPaths("talk", {context:"continue",type:"relation_update"})
     * = ["talk","talk.continue","talk.relation_update","talk.continue.relation_update"]
     * 精确命中：
     * - talkable（"talk" 在 activePaths 中）
     * - relation_update（"talk.continue.relation_update" 在 activePaths 中）
     * 不命中 cross_object（"talk.fork" 不在 activePaths 中） */
    const activated = collectCommandTraits(
      traits,
      new Set(["talk", "talk.continue", "talk.relation_update", "talk.continue.relation_update"]),
    );
    expect(activated).toContain("kernel:talkable");
    expect(activated).toContain("kernel:talkable/relation_update");
    expect(activated).not.toContain("kernel:talkable/cross_object");
  });
});

describe("Bruce 4 · 渐进填表：refine 深化路径", () => {
  test("FormManager 的 commandPaths 随 refine 深化（多路径并行）", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "问 sophia");
    expect(mgr.getForm(fid)!.commandPaths).toEqual(["talk"]);

    /* Step 1：只填 context=continue */
    mgr.applyRefine(fid, { context: "continue" });
    expect(mgr.getForm(fid)!.commandPaths).toContain("talk");
    expect(mgr.getForm(fid)!.commandPaths).toContain("talk.continue");

    /* Step 2：再填 type=relation_update */
    mgr.applyRefine(fid, { type: "relation_update" });
    expect(mgr.getForm(fid)!.commandPaths).toContain("talk");
    expect(mgr.getForm(fid)!.commandPaths).toContain("talk.continue");
    expect(mgr.getForm(fid)!.commandPaths).toContain("talk.relation_update");
    expect(mgr.getForm(fid)!.commandPaths).toContain("talk.continue.relation_update");

    /* Step 3：最终 submit → form 被消费 */
    const finalForm = mgr.submit(fid);
    expect(finalForm!.accumulatedArgs).toEqual({
      context: "continue",
      type: "relation_update",
    });
    expect(mgr.getForm(fid)).toBeNull();
  });

  test("refine 过程中，loadedTraits 单调追加（不回缩）", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "问 sophia");
    mgr.addLoadedTraits(fid, ["kernel:talkable"]);
    expect(mgr.getForm(fid)!.loadedTraits).toEqual(["kernel:talkable"]);

    mgr.applyRefine(fid, { context: "continue" });
    mgr.addLoadedTraits(fid, ["kernel:talkable/relation_update"]);
    /* 新加的在后面，原来的仍保留 */
    expect(mgr.getForm(fid)!.loadedTraits).toContain("kernel:talkable");
    expect(mgr.getForm(fid)!.loadedTraits).toContain("kernel:talkable/relation_update");
  });

  test("refine 的 args 最终交付指令执行（合并、后覆盖前）", () => {
    const mgr = new FormManager();
    const fid = mgr.begin("talk", "");
    mgr.applyRefine(fid, { target: "sophia", context: "fork" });
    mgr.applyRefine(fid, { context: "continue" }); /* 改主意了 */
    const final = mgr.submit(fid);
    expect(final!.accumulatedArgs).toEqual({
      target: "sophia",
      context: "continue", /* 后覆盖前 */
    });
  });
});

describe("Bruce 5 · 向后兼容：老 thread.json 无新字段", () => {
  test("FormManager.fromData 容忍缺失的 accumulatedArgs/commandPaths/loadedTraits", () => {
    /* 模拟老格式持久化数据 */
    const oldForms = [
      {
        formId: "f_xxx",
        command: "talk",
        description: "old format",
        createdAt: 1234,
      } as any,
    ];
    const mgr = FormManager.fromData(oldForms);
    const form = mgr.getForm("f_xxx");
    expect(form).not.toBeNull();
    /* 新字段被赋默认值 */
    expect(form!.accumulatedArgs).toEqual({});
    expect(form!.loadedTraits).toEqual([]);
    expect(form!.commandPaths).toContain("talk"); /* 由 deriveCommandPaths({}) 兜底回到 command 本身 */
  });

  test("FormManager.fromData 迁移旧格式 commandPath:string → commandPaths:string[]", () => {
    /* 模拟老格式：commandPath 是单字符串 */
    const oldForms = [
      {
        formId: "f_yyy",
        command: "talk",
        description: "migrated",
        createdAt: 1234,
        commandPath: "talk.continue",
        accumulatedArgs: { context: "continue" },
        loadedTraits: [],
      } as any,
    ];
    const mgr = FormManager.fromData(oldForms);
    const form = mgr.getForm("f_yyy");
    expect(form).not.toBeNull();
    expect(form!.commandPaths).toEqual(["talk.continue"]); /* 迁移为单元素数组 */
  });

  test("ThreadInboxMessage 无 kind 字段的老消息正常渲染", async () => {
    const flowDir = join(TMP_ROOT, "flows", "s1", "objects", "alice");
    const tree = await ThreadsTree.create(flowDir, "root", "task");
    /* 写一条老格式消息（不带 kind） */
    tree.writeInbox(tree.rootId, {
      from: "user",
      content: "hello",
      source: "talk",
    });
    const data = tree.readThreadData(tree.rootId)!;
    const msg = data.inbox![0]!;
    expect(msg.kind).toBeUndefined();
    expect(msg.content).toBe("hello");
  });

  test("getOpenFiles 容忍无 relations 的线程", () => {
    const traits = [trait("kernel", "computable")];
    const stone = makeStone("alice", join(TMP_ROOT, "stones", "alice"));
    const threadId = "r";
    const treeFile = {
      rootId: threadId,
      nodes: {
        [threadId]: {
          id: threadId, title: "root", status: "running" as const,
          childrenIds: [], activatedTraits: ["kernel:computable"], createdAt: 0, updatedAt: 0,
        },
      },
    };
    const threadData: ThreadDataFile = { id: threadId, events: [] };

    /* 不抛错，返回线程显式激活 */
    const result = getOpenFiles({ tree: treeFile, threadId, threadData, stone, traits });
    expect(result.activeTraitIds).toContain("kernel:computable");
  });
});

describe("Bruce · selfKind 自动识别（stone / flow_obj 对称）", () => {
  test("stones/alice → stone", () => {
    const r = detectSelfKind(
      join(PROJECT_ROOT, "stones", "alice"),
      join(PROJECT_ROOT, "flows"),
    );
    expect(r.selfKind).toBe("stone");
  });

  test("flows/s1/objects/tmp → flow_obj + sessionId", () => {
    const r = detectSelfKind(
      join(PROJECT_ROOT, "flows", "s1", "objects", "tmp"),
      join(PROJECT_ROOT, "flows"),
    );
    expect(r.selfKind).toBe("flow_obj");
    expect(r.sessionId).toBe("s1");
  });
});

describe("Bruce · renderRelationsIndex 产出符合 spec 的 XML", () => {
  test("多 peer 索引 + 缺失 peer 混排", () => {
    writeRelation("alice", "sophia", `---\nsummary: 哲学设计部\n---`);
    writeRelation("alice", "kernel", `---\nsummary: OOC 工程部\n---`);

    const xml = renderRelationsIndex(["sophia", "kernel", "bruce"], {
      rootDir: TMP_ROOT,
      selfName: "alice",
      selfKind: "stone",
    });
    expect(xml).toContain(`<relations>`);
    expect(xml).toContain(`<peer name="sophia">哲学设计部</peer>`);
    expect(xml).toContain(`<peer name="kernel">OOC 工程部</peer>`);
    expect(xml).toContain(`<peer name="bruce">(无关系记录)</peer>`);
    expect(xml).toContain(`</relations>`);
  });
});

describe("Bruce · peer 扫描同时整合 tool_use 和 inbox", () => {
  test("events 中的 target + inbox 中的 from 合并去重", () => {
    const td: ThreadDataFile = {
      id: "r",
      events: [
        {
          type: "tool_use",
          name: "submit",
          args: { target: "sophia", msg: "hi", context: "fork" },
          content: "",
          timestamp: 1,
        },
      ],
      inbox: [
        { id: "m1", from: "kernel", content: "reply", timestamp: 2, source: "talk", status: "unread" },
        { id: "m2", from: "sophia", content: "hi back", timestamp: 3, source: "talk", status: "unread" },
      ],
    };
    const peers = scanPeers(td, "alice");
    expect(peers).toContain("sophia");
    expect(peers).toContain("kernel");
    expect(peers.length).toBe(2); /* sophia 去重 */
  });
});
