import { describe, expect, test } from "bun:test";
import { __testing } from "../_shared/session-path";

const { rewriteStonesPath, rewritePoolsPath } = __testing;

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
