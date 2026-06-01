import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { __testing } from "../_shared/session-path";

const { rewritePackagesPath, rewritePoolsPath, classifyPackagesPath, classifyStonesPath } = __testing;

let tempRoot: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-session-path-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function createObjectPackage(baseDir: string, objectId: string): Promise<void> {
  const segs = objectId.split("/");
  let current = join(baseDir, "packages");
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) current = join(current, "children");
    current = join(current, segs[i]!);
  }
  await mkdir(current, { recursive: true });
  await writeFile(join(current, "package.json"), JSON.stringify({ name: objectId, version: "0.1.0" }), "utf8");
}

describe("rewritePackagesPath: stones/ → packages/ backward compat", () => {
  test("stones/<id>/foo → packages/<id>/foo", () => {
    expect(rewritePackagesPath("stones/agent_of_x/self.md")).toBe(
      "packages/agent_of_x/self.md",
    );
  });

  test("nested stones/ path → packages/ with children/ injection", () => {
    expect(rewritePackagesPath("stones/sentry/sentry_factor_dev/self.md")).toBe(
      "packages/sentry/sentry_factor_dev/self.md",
    );
  });

  test("already packages/ paths are left alone", () => {
    expect(rewritePackagesPath("packages/agent_of_x/self.md")).toBe(
      "packages/agent_of_x/self.md",
    );
  });

  test("non-stones paths are not rewritten", () => {
    expect(rewritePackagesPath("flows/super/threads/root.json")).toBe("flows/super/threads/root.json");
    expect(rewritePackagesPath("docs/plans/foo.md")).toBe("docs/plans/foo.md");
  });

  test("'./stones/<id>' prefix is honored", () => {
    expect(rewritePackagesPath("./stones/agent_of_x/self.md")).toBe(
      "packages/agent_of_x/self.md",
    );
  });

  test("backslash separator normalized", () => {
    expect(rewritePackagesPath("stones\\agent_of_x\\self.md")).toBe(
      "packages/agent_of_x/self.md",
    );
  });
});

describe("rewritePoolsPath: pools/ passthrough (no objects/ injection after bun workspace migration)", () => {
  test("pools/<id>/foo → pools/<id>/foo (no injection)", () => {
    expect(rewritePoolsPath("pools/agent_of_x/data/events.csv")).toBe(
      "pools/agent_of_x/data/events.csv",
    );
  });

  test("pools/objects/<id>/... is left alone (backward compat)", () => {
    expect(rewritePoolsPath("pools/objects/agent_of_x/knowledge/memory/foo.md")).toBe(
      "pools/objects/agent_of_x/knowledge/memory/foo.md",
    );
  });

  test("non-pools paths are not rewritten", () => {
    expect(rewritePoolsPath("flows/super/threads/root.json")).toBe("flows/super/threads/root.json");
    expect(rewritePoolsPath("packages/agent_of_x/self.md")).toBe(
      "packages/agent_of_x/self.md",
    );
  });

  test("'./pools/<id>' prefix is honored", () => {
    expect(rewritePoolsPath("./pools/agent_of_x/files/foo.bin")).toBe(
      "./pools/agent_of_x/files/foo.bin",
    );
  });

  test("backslash separator is passed through", () => {
    expect(rewritePoolsPath("pools\\agent_of_x\\knowledge\\memory\\foo.md")).toBe(
      "pools\\agent_of_x\\knowledge\\memory\\foo.md",
    );
  });
});

describe("classifyPackagesPath: package boundary detection", () => {
  test("packages/<id>/... → package-object（ownerObjectId + relInPackages）", async () => {
    const baseDir = tempRoot!;
    await createObjectPackage(baseDir, "agent_of_x");
    const abs = resolve(baseDir, "packages/agent_of_x/self.md");
    const r = classifyPackagesPath(abs, baseDir);
    expect(r.kind).toBe("package-object");
    if (r.kind === "package-object") {
      expect(r.ownerObjectId).toBe("agent_of_x");
      expect(r.relInPackages).toBe("agent_of_x/self.md");
    }
  });

  test("packages/@ooc/core/... → packages-world（source package under @ scope）", () => {
    const baseDir = tempRoot!;
    const abs = resolve(baseDir, "packages/@ooc/core/persistable/common.ts");
    const r = classifyPackagesPath(abs, baseDir);
    expect(r.kind).toBe("packages-world");
  });

  test("嵌套子 Object packages/parent/children/child/... → owner = parent/child", async () => {
    const baseDir = tempRoot!;
    await createObjectPackage(baseDir, "parent/child");
    const abs = resolve(baseDir, "packages/parent/children/child/self.md");
    const r = classifyPackagesPath(abs, baseDir);
    expect(r.kind).toBe("package-object");
    if (r.kind === "package-object") {
      expect(r.ownerObjectId).toBe("parent/child");
      expect(r.relInPackages).toBe("parent/children/child/self.md");
    }
  });

  test("packages/ 根下非 object 资源 → packages-world", () => {
    const baseDir = tempRoot!;
    const abs = resolve(baseDir, "packages/.gitkeep");
    const r = classifyPackagesPath(abs, baseDir);
    expect(r.kind).toBe("packages-world");
  });

  test("非 packages 树（pools/）→ non-package", () => {
    const baseDir = tempRoot!;
    const abs = resolve(baseDir, "pools/agent_of_x/data/x.csv");
    expect(classifyPackagesPath(abs, baseDir).kind).toBe("non-package");
  });

  test("无 baseDir → non-package（纯内存测试场景不路由）", () => {
    const baseDir = tempRoot!;
    const abs = resolve(baseDir, "packages/agent_of_x/self.md");
    expect(classifyPackagesPath(abs, undefined).kind).toBe("non-package");
  });

  test("packages/ 根本身 → non-package（空 rel）", () => {
    const baseDir = tempRoot!;
    const abs = resolve(baseDir, "packages");
    expect(classifyPackagesPath(abs, baseDir).kind).toBe("non-package");
  });
});

describe("classifyStonesPath: backward compat wrapper", () => {
  test("stones/ paths auto-rewrite to packages/ classification", async () => {
    const baseDir = tempRoot!;
    await createObjectPackage(baseDir, "agent_of_x");
    const abs = resolve(baseDir, "packages/agent_of_x/self.md");
    const r = classifyStonesPath(abs, baseDir);
    expect(r.kind).toBe("stone-object");
    if (r.kind === "stone-object") {
      expect(r.ownerObjectId).toBe("agent_of_x");
    }
  });
});
