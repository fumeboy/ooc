/**
 * Relation 文件读取与索引渲染单测（Phase 5）
 *
 * 覆盖降级链：summary frontmatter → 正文首行 → 文件名 → (无关系记录)。
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  locateRelationFile,
  readPeerRelation,
  readPeerRelations,
  renderRelationsIndex,
} from "../src/thread/relation.js";

const TMP_ROOT = "/tmp/ooc-relation-test";

beforeEach(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
  mkdirSync(TMP_ROOT, { recursive: true });
});
afterEach(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

function writeRelationFile(self: string, peer: string, content: string) {
  const dir = join(TMP_ROOT, "stones", self, "relations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${peer}.md`), content, "utf-8");
}

describe("locateRelationFile", () => {
  test("stone 场景拼路径", () => {
    expect(
      locateRelationFile("sophia", { rootDir: "/r", selfName: "alice" }),
    ).toBe("/r/stones/alice/relations/sophia.md");
  });

  test("flow_obj 场景需 sessionId", () => {
    expect(
      locateRelationFile("sophia", {
        rootDir: "/r",
        selfName: "tmp",
        selfKind: "flow_obj",
        sessionId: "s1",
      }),
    ).toBe("/r/flows/s1/objects/tmp/relations/sophia.md");
  });

  test("flow_obj 缺 sessionId → null", () => {
    expect(
      locateRelationFile("sophia", {
        rootDir: "/r",
        selfName: "tmp",
        selfKind: "flow_obj",
      }),
    ).toBeNull();
  });

  test("空 peer → null", () => {
    expect(locateRelationFile("", { rootDir: "/r", selfName: "alice" })).toBeNull();
  });
});

describe("readPeerRelation — 降级链", () => {
  test("frontmatter.summary 优先", () => {
    writeRelationFile(
      "alice",
      "sophia",
      `---\nsummary: 哲学设计部，所有 G/E 编号变更必经\ntags: [philosophy]\n---\n\n# relationship\n\n详情...`,
    );
    const entry = readPeerRelation("sophia", {
      rootDir: TMP_ROOT,
      selfName: "alice",
    });
    expect(entry.summary).toBe("哲学设计部，所有 G/E 编号变更必经");
    expect(entry.hasFile).toBe(true);
  });

  test("无 frontmatter → 正文首行（去掉 # 前缀）", () => {
    writeRelationFile("alice", "kernel", `# 与 kernel 的关系\n\nTDD 流程 + 哲学审查`);
    const entry = readPeerRelation("kernel", {
      rootDir: TMP_ROOT,
      selfName: "alice",
    });
    expect(entry.summary).toBe("与 kernel 的关系");
  });

  test("正文为空 → 文件名 fallback", () => {
    writeRelationFile("alice", "bruce", `---\ntags: [empty]\n---\n\n`);
    const entry = readPeerRelation("bruce", {
      rootDir: TMP_ROOT,
      selfName: "alice",
    });
    expect(entry.summary).toBe("bruce.md");
  });

  test("文件不存在 → (无关系记录)", () => {
    const entry = readPeerRelation("ghost", {
      rootDir: TMP_ROOT,
      selfName: "alice",
    });
    expect(entry.summary).toBe("(无关系记录)");
    expect(entry.hasFile).toBe(false);
  });
});

describe("renderRelationsIndex", () => {
  test("空 peers → 空串", () => {
    expect(renderRelationsIndex([], { rootDir: TMP_ROOT, selfName: "alice" })).toBe("");
  });

  test("单 peer 有文件", () => {
    writeRelationFile(
      "alice",
      "sophia",
      `---\nsummary: 设计审查 + G/E 编号守门\n---\n\n# 关系\n...`,
    );
    const out = renderRelationsIndex(["sophia"], {
      rootDir: TMP_ROOT,
      selfName: "alice",
    });
    expect(out).toContain(`<peer name="sophia">设计审查 + G/E 编号守门</peer>`);
    expect(out.startsWith("<relations>")).toBe(true);
    expect(out.endsWith("</relations>")).toBe(true);
  });

  test("混合：有文件 + 无文件", () => {
    writeRelationFile(
      "alice",
      "sophia",
      `---\nsummary: 哲学设计部\n---\n`,
    );
    const out = renderRelationsIndex(["sophia", "bruce"], {
      rootDir: TMP_ROOT,
      selfName: "alice",
    });
    expect(out).toContain(`<peer name="sophia">哲学设计部</peer>`);
    expect(out).toContain(`<peer name="bruce">(无关系记录)</peer>`);
  });

  test("XML 特殊字符转义（< > &）", () => {
    writeRelationFile(
      "alice",
      "peerx",
      `---\nsummary: a < b & c > d\n---\n`,
    );
    const out = renderRelationsIndex(["peerx"], {
      rootDir: TMP_ROOT,
      selfName: "alice",
    });
    expect(out).toContain("a &lt; b &amp; c &gt; d");
  });
});

describe("readPeerRelations — 批量", () => {
  test("保持入参顺序", () => {
    writeRelationFile("alice", "a", `---\nsummary: S_A\n---`);
    writeRelationFile("alice", "b", `---\nsummary: S_B\n---`);
    const r = readPeerRelations(["b", "a"], { rootDir: TMP_ROOT, selfName: "alice" });
    expect(r.map((e) => e.name)).toEqual(["b", "a"]);
    expect(r.map((e) => e.summary)).toEqual(["S_B", "S_A"]);
  });
});
