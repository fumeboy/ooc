import { describe, expect, test } from "bun:test";
import { __testing } from "../session-path";

const { rewriteStonesPath } = __testing;

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
