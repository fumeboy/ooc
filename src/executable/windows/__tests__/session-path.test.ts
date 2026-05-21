import { describe, expect, test } from "bun:test";
import { __testing } from "../session-path";

const { rewriteStonesPath } = __testing;

describe("rewriteStonesPath: stonesBranch routing", () => {
  test("stones/<id>/foo → stones/main/<id>/foo when branch is main", () => {
    expect(rewriteStonesPath("stones/agent_of_x/self.md", "main")).toBe("stones/main/agent_of_x/self.md");
  });

  test("stones/<id>/foo → stones/<branch>/<id>/foo when branch is metaprog", () => {
    expect(rewriteStonesPath("stones/agent_of_x/self.md", "metaprog/agent_of_x/abc")).toBe(
      "stones/metaprog/agent_of_x/abc/agent_of_x/self.md",
    );
  });

  test("already explicit stones/main/<id>/... is left alone", () => {
    expect(rewriteStonesPath("stones/main/agent_of_x/self.md", "metaprog/foo/x")).toBe(
      "stones/main/agent_of_x/self.md",
    );
  });

  test("explicit stones/metaprog/... is left alone", () => {
    expect(rewriteStonesPath("stones/metaprog/agent_of_x/abc/agent_of_x/self.md", "main")).toBe(
      "stones/metaprog/agent_of_x/abc/agent_of_x/self.md",
    );
  });

  test("non-stones paths are not rewritten", () => {
    expect(rewriteStonesPath("flows/super/threads/root.json", "main")).toBe("flows/super/threads/root.json");
    expect(rewriteStonesPath("docs/plans/foo.md", "main")).toBe("docs/plans/foo.md");
  });

  test("'./stones/<id>' prefix is honored", () => {
    expect(rewriteStonesPath("./stones/agent_of_x/self.md", "main")).toBe("stones/main/agent_of_x/self.md");
  });

  test("backslash separator normalized", () => {
    expect(rewriteStonesPath("stones\\agent_of_x\\self.md", "main")).toBe("stones/main/agent_of_x/self.md");
  });
});
