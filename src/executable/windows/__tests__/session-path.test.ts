import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { __testing } from "../_shared/session-path";

const { rewriteStonesPath, rewritePoolsPath, classifyStonesPath } = __testing;

describe("rewriteStonesPath: stonesBranch + objects/ injection", () => {
  test("stones/<id>/foo → stones/main/objects/<id>/foo when branch is main", () => {
    expect(rewriteStonesPath("stones/agent_of_x/self.md", "main")).toBe(
      "stones/main/objects/agent_of_x/self.md",
    );
  });

  test("stones/<id>/foo → stones/<branch>/objects/<id>/foo when branch is metaprog", () => {
    expect(rewriteStonesPath("stones/agent_of_x/self.md", "metaprog/agent_of_x/abc")).toBe(
      "stones/metaprog/agent_of_x/abc/objects/agent_of_x/self.md",
    );
  });

  test("already explicit stones/main/<...> is left alone (caller owns layout)", () => {
    expect(rewriteStonesPath("stones/main/objects/agent_of_x/self.md", "metaprog/foo/x")).toBe(
      "stones/main/objects/agent_of_x/self.md",
    );
  });

  test("stones/main/<world-level-file> is left alone (no objects/ injection)", () => {
    // World-level file under stones/main/ root; rewriter should not 注入 objects/
    expect(rewriteStonesPath("stones/main/.gitignore", "metaprog/foo/x")).toBe(
      "stones/main/.gitignore",
    );
  });

  test("explicit stones/metaprog/... is left alone", () => {
    expect(rewriteStonesPath("stones/metaprog/agent_of_x/abc/objects/agent_of_x/self.md", "main")).toBe(
      "stones/metaprog/agent_of_x/abc/objects/agent_of_x/self.md",
    );
  });

  test("non-stones paths are not rewritten", () => {
    expect(rewriteStonesPath("flows/super/threads/root.json", "main")).toBe("flows/super/threads/root.json");
    expect(rewriteStonesPath("docs/plans/foo.md", "main")).toBe("docs/plans/foo.md");
  });

  test("'./stones/<id>' prefix is honored", () => {
    expect(rewriteStonesPath("./stones/agent_of_x/self.md", "main")).toBe(
      "stones/main/objects/agent_of_x/self.md",
    );
  });

  test("backslash separator normalized", () => {
    expect(rewriteStonesPath("stones\\agent_of_x\\self.md", "main")).toBe(
      "stones/main/objects/agent_of_x/self.md",
    );
  });
});

describe("rewritePoolsPath: pools/objects/ injection (no branch)", () => {
  test("pools/<id>/foo → pools/objects/<id>/foo", () => {
    expect(rewritePoolsPath("pools/agent_of_x/data/events.csv")).toBe(
      "pools/objects/agent_of_x/data/events.csv",
    );
  });

  test("already explicit pools/objects/<id>/... is left alone", () => {
    expect(rewritePoolsPath("pools/objects/agent_of_x/knowledge/memory/foo.md")).toBe(
      "pools/objects/agent_of_x/knowledge/memory/foo.md",
    );
  });

  test("non-pools paths are not rewritten", () => {
    expect(rewritePoolsPath("flows/super/threads/root.json")).toBe("flows/super/threads/root.json");
    expect(rewritePoolsPath("stones/main/objects/agent_of_x/self.md")).toBe(
      "stones/main/objects/agent_of_x/self.md",
    );
  });

  test("'./pools/<id>' prefix is honored", () => {
    expect(rewritePoolsPath("./pools/agent_of_x/files/foo.bin")).toBe(
      "pools/objects/agent_of_x/files/foo.bin",
    );
  });

  test("backslash separator normalized", () => {
    expect(rewritePoolsPath("pools\\agent_of_x\\knowledge\\memory\\foo.md")).toBe(
      "pools/objects/agent_of_x/knowledge/memory/foo.md",
    );
  });
});

describe("classifyStonesPath: stone-versioning routing 归属判定", () => {
  const baseDir = "/world";

  test("objects/<id>/... → stone-object（ownerObjectId + relInObjects）", () => {
    const abs = resolve(baseDir, "stones/main/objects/agent_of_x/self.md");
    const r = classifyStonesPath(abs, baseDir, "main");
    expect(r.kind).toBe("stone-object");
    if (r.kind === "stone-object") {
      expect(r.ownerObjectId).toBe("agent_of_x");
      expect(r.relInObjects).toBe("objects/agent_of_x/self.md");
    }
  });

  test("嵌套子 Object objects/parent/children/child/... → owner = 第一段", () => {
    const abs = resolve(baseDir, "stones/main/objects/parent/children/child/self.md");
    const r = classifyStonesPath(abs, baseDir, "main");
    expect(r.kind).toBe("stone-object");
    if (r.kind === "stone-object") {
      expect(r.ownerObjectId).toBe("parent");
      expect(r.relInObjects).toBe("objects/parent/children/child/self.md");
    }
  });

  test("stones/<branch>/ 根下非 objects/ 资源 → stones-world", () => {
    const abs = resolve(baseDir, "stones/main/.gitignore");
    const r = classifyStonesPath(abs, baseDir, "main");
    expect(r.kind).toBe("stones-world");
  });

  test("非 stones 树（pools/）→ non-stone", () => {
    const abs = resolve(baseDir, "pools/objects/agent_of_x/data/x.csv");
    expect(classifyStonesPath(abs, baseDir, "main").kind).toBe("non-stone");
  });

  test("不同 branch 隔离：写 main 但 session branch 是 metaprog → non-stone", () => {
    const abs = resolve(baseDir, "stones/main/objects/agent_of_x/self.md");
    expect(classifyStonesPath(abs, baseDir, "metaprog/x/abc").kind).toBe("non-stone");
  });

  test("无 baseDir → non-stone（纯内存测试场景不路由）", () => {
    const abs = resolve(baseDir, "stones/main/objects/agent_of_x/self.md");
    expect(classifyStonesPath(abs, undefined, "main").kind).toBe("non-stone");
  });

  test("objects/ 根本身（无 ownerId 段）→ stones-world", () => {
    const abs = resolve(baseDir, "stones/main/objects");
    expect(classifyStonesPath(abs, baseDir, "main").kind).toBe("stones-world");
  });
});
