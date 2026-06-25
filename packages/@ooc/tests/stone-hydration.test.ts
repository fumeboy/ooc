/**
 * stone hydration test —— 验证 hydrateSession 自动把 stones/main/objects/<id>/ 实例化进对象表。
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@ooc/core/runtime/object-register.builtins";
import {
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import { hydrateSession } from "@ooc/core/persistable/runtime-object-io";

const SID = "stone-hydrate-test";
let baseDir: string;

describe("stone hydration", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-stone-test-"));
    // 写一个 supervisor stone object
    const supDir = join(baseDir, "stones", "main", "objects", "supervisor");
    await mkdir(supDir, { recursive: true });
    await writeFile(
      join(supDir, "package.json"),
      JSON.stringify({ ooc: { objectId: "supervisor", kind: "object", class: "_builtin/agent" } }),
      "utf8",
    );
    await writeFile(join(supDir, "self.md"), "# supervisor\nI am the OOC system supervisor.", "utf8");
  });
  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
    releaseSessionRegistry(SID);
  });

  it("hydrateSession picks up stone supervisor instance", async () => {
    const reg = await hydrateSession(baseDir, SID);
    const sup = reg.getObject("supervisor");
    expect(sup).toBeDefined();
    expect(sup?.class).toBe("_builtin/agent");
    expect((sup?.data as { self: string }).self).toContain("OOC system supervisor");
  });
});
