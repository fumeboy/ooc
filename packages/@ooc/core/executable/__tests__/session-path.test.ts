import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { __testing, resolveSessionPath } from "@ooc/core/executable/session-path.js";
import type { ThreadPersistenceRef } from "@ooc/core/_shared/types/thread.js";

const { rewritePackagesPath, rewritePoolsPath, classifyPackagesPath } = __testing;

/** 构造带 baseDir 的最小 persistence ref（resolveSessionPath 只读 baseDir）。 */
function threadWithBase(baseDir: string): ThreadPersistenceRef {
  return { baseDir, sessionId: "s", objectId: "o", threadId: "t" };
}

describe("resolveSessionPath 安全：data 原语不得逃逸 world 根（harness executable 回归）", () => {
  const BASE = "/tmp/ooc-world-x";
  test("相对 ../ 逃逸 → 抛", () => {
    expect(() => resolveSessionPath(threadWithBase(BASE), "../escape.txt")).toThrow(/逃逸/);
    expect(() => resolveSessionPath(threadWithBase(BASE), "a/../../escape.txt")).toThrow(/逃逸/);
  });
  test("world 外绝对路径 → 抛", () => {
    expect(() => resolveSessionPath(threadWithBase(BASE), "/etc/passwd")).toThrow(/逃逸/);
  });
  test("world 内相对/绝对路径 → 放行（解析在 baseDir 下）", () => {
    expect(resolveSessionPath(threadWithBase(BASE), "hello.txt")).toBe(`${BASE}/hello.txt`);
    expect(resolveSessionPath(threadWithBase(BASE), "packages/assistant/self.md")).toBe(`${BASE}/packages/assistant/self.md`);
    expect(resolveSessionPath(threadWithBase(BASE), `${BASE}/inside.txt`)).toBe(`${BASE}/inside.txt`);
  });
  test("无 baseDir（纯内存测试）→ 保持旧行为不抛", () => {
    expect(() => resolveSessionPath(undefined, "../x.txt")).not.toThrow();
  });
});

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
  // 收口：对象在 canonical main worktree stones/main/objects/<nestedPath>/
  let current = join(baseDir, "stones", "main", "objects");
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) current = join(current, "children");
    current = join(current, segs[i]!);
  }
  await mkdir(current, { recursive: true });
  await writeFile(join(current, "package.json"), JSON.stringify({ name: objectId, version: "0.1.0" }), "utf8");
}

describe("rewritePackagesPath: stones/<id>/ → stones/main/objects/<id>/ 收口", () => {
  test("stones/<id>/foo → stones/main/objects/<id>/foo", () => {
    expect(rewritePackagesPath("stones/agent_of_x/self.md")).toBe(
      "stones/main/objects/agent_of_x/self.md",
    );
  });

  test("nested stones/ path → stones/main/objects/ 注入", () => {
    expect(rewritePackagesPath("stones/sentry/sentry_factor_dev/self.md")).toBe(
      "stones/main/objects/sentry/sentry_factor_dev/self.md",
    );
  });

  test("显式 stones/main/... → 原样（不双重注入；含 main 根资源）", () => {
    expect(rewritePackagesPath("stones/main/objects/agent_of_x/self.md")).toBe(
      "stones/main/objects/agent_of_x/self.md",
    );
    expect(rewritePackagesPath("stones/main/.gitignore")).toBe("stones/main/.gitignore");
  });

  test("already packages/ paths（builtin）are left alone", () => {
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
      "stones/main/objects/agent_of_x/self.md",
    );
  });

  test("backslash separator normalized", () => {
    expect(rewritePackagesPath("stones\\agent_of_x\\self.md")).toBe(
      "stones/main/objects/agent_of_x/self.md",
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
  test("stones/main/objects/<id>/... → package-object（ownerObjectId + relInPackages）", async () => {
    const baseDir = tempRoot!;
    await createObjectPackage(baseDir, "agent_of_x");
    const abs = resolve(baseDir, "stones/main/objects/agent_of_x/self.md");
    const r = classifyPackagesPath(abs, baseDir);
    expect(r.kind).toBe("package-object");
    if (r.kind === "package-object") {
      expect(r.ownerObjectId).toBe("agent_of_x");
      expect(r.relInPackages).toBe("agent_of_x/self.md");
    }
  });

  test("packages/@ooc/core/... → non-package（packages/ 不再是对象树，不在 stones/main/ 内）", () => {
    const baseDir = tempRoot!;
    const abs = resolve(baseDir, "packages/@ooc/core/persistable/common.ts");
    const r = classifyPackagesPath(abs, baseDir);
    expect(r.kind).toBe("non-package");
  });

  test("嵌套子 Object stones/main/objects/parent/children/child/... → owner = parent/child", async () => {
    const baseDir = tempRoot!;
    await createObjectPackage(baseDir, "parent/child");
    const abs = resolve(baseDir, "stones/main/objects/parent/children/child/self.md");
    const r = classifyPackagesPath(abs, baseDir);
    expect(r.kind).toBe("package-object");
    if (r.kind === "package-object") {
      expect(r.ownerObjectId).toBe("parent/child");
      expect(r.relInPackages).toBe("parent/children/child/self.md");
    }
  });

  test("stones/main/ 根下非 objects/ 资源 → packages-world（workspace-level）", () => {
    const baseDir = tempRoot!;
    const abs = resolve(baseDir, "stones/main/.gitignore");
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
