/**
 * reflectable smoke test —— 验证 sediment knowledge + create_object skeleton。
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sedimentKnowledge,
  createObjectSkeleton,
} from "@ooc/core/persistable/reflectable";

let baseDir: string;

describe("reflectable", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-reflect-test-"));
  });
  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("sedimentKnowledge writes a markdown file under pools/", async () => {
    await sedimentKnowledge(baseDir, "my_agent", "memory/task1", "## task1\nnotes here");
    const file = join(baseDir, "pools", "objects", "my_agent", "knowledge", "memory", "task1.md");
    const s = await stat(file);
    expect(s.isFile()).toBe(true);
    const text = await readFile(file, "utf8");
    expect(text).toContain("## task1");
  });

  it("createObjectSkeleton writes self.md + readable.md + package.json + knowledge/", async () => {
    const result = await createObjectSkeleton({
      baseDir,
      objectId: "new_agent",
      selfMd: "# new_agent\nI am new.",
      readableMd: "# new_agent\nHello from new agent.",
      knowledge: { "intro": "# intro\nfirst knowledge", "tools": "# tools\nlist" },
      parentClass: "_builtin/agent",
    });
    expect(result.ok).toBe(true);
    expect(result.objectId).toBe("new_agent");

    // self.md
    const selfMd = await readFile(join(result.dir, "self.md"), "utf8");
    expect(selfMd).toContain("# new_agent");

    // readable.md
    const readableMd = await readFile(join(result.dir, "readable.md"), "utf8");
    expect(readableMd).toContain("Hello from new agent");

    // package.json
    const pkg = JSON.parse(await readFile(join(result.dir, "package.json"), "utf8"));
    expect(pkg.ooc).toEqual({ objectId: "new_agent", kind: "object", class: "_builtin/agent" });

    // knowledge/
    expect(await readFile(join(result.dir, "knowledge", "intro.md"), "utf8")).toContain("first knowledge");
    expect(await readFile(join(result.dir, "knowledge", "tools.md"), "utf8")).toContain("# tools");
  });

  it("nested objectId writes to children/ path", async () => {
    const result = await createObjectSkeleton({
      baseDir,
      objectId: "parent_agent/child_agent",
      selfMd: "child",
    });
    expect(result.dir).toContain(join("parent_agent", "children", "child_agent"));
    const s = await stat(join(result.dir, "self.md"));
    expect(s.isFile()).toBe(true);
  });
});
