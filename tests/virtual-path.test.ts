/**
 * 虚拟路径解析单测（Phase 2）
 *
 * 把 `@trait:kernel/computable` / `@relation:kernel` 等虚拟路径解析为
 * 真实文件系统路径（TRAIT.md / relations/{peer}.md）。
 *
 * Namespace 分派：
 * - @trait:kernel/X     → <rootDir>/kernel/traits/X/TRAIT.md
 * - @trait:library/X    → <rootDir>/library/traits/X/TRAIT.md
 * - @trait:self/X       → <rootDir>/stones/{selfName}/traits/X/TRAIT.md（self 场景）
 * - @relation:X         → <rootDir>/stones/{selfName}/relations/X.md
 *   flow obj 场景 → <rootDir>/flows/{sid}/objects/{selfName}/relations/X.md
 * - 普通路径（不带 @）→ 原样返回（相对 rootDir 由调用方处理）
 */

import { describe, test, expect } from "bun:test";
import {
  resolveVirtualPath,
  isVirtualPath,
} from "../src/thread/virtual-path.js";

describe("isVirtualPath", () => {
  test("@trait: / @relation: 开头视为虚拟路径", () => {
    expect(isVirtualPath("@trait:kernel/computable")).toBe(true);
    expect(isVirtualPath("@relation:sophia")).toBe(true);
  });

  test("普通路径不是虚拟路径", () => {
    expect(isVirtualPath("docs/gene.md")).toBe(false);
    expect(isVirtualPath("/tmp/x.md")).toBe(false);
    expect(isVirtualPath("")).toBe(false);
  });
});

describe("resolveVirtualPath — @trait:", () => {
  const rootDir = "/root";
  const selfName = "alice";

  test("kernel namespace → kernel/traits/<name>/TRAIT.md", () => {
    expect(
      resolveVirtualPath("@trait:kernel/computable", { rootDir, selfName }),
    ).toBe("/root/kernel/traits/computable/TRAIT.md");
  });

  test("library namespace → library/traits/<name>/TRAIT.md", () => {
    expect(
      resolveVirtualPath("@trait:library/lark/doc", { rootDir, selfName }),
    ).toBe("/root/library/traits/lark/doc/TRAIT.md");
  });

  test("self namespace → stones/<self>/traits/<name>/TRAIT.md（stone 场景）", () => {
    expect(
      resolveVirtualPath("@trait:self/reporter", {
        rootDir,
        selfName,
        selfKind: "stone",
      }),
    ).toBe("/root/stones/alice/traits/reporter/TRAIT.md");
  });

  test("self namespace + flow obj → flows/<sid>/objects/<self>/traits/<name>/TRAIT.md", () => {
    expect(
      resolveVirtualPath("@trait:self/reporter", {
        rootDir,
        selfName: "tmp_obj",
        selfKind: "flow_obj",
        sessionId: "s_001",
      }),
    ).toBe("/root/flows/s_001/objects/tmp_obj/traits/reporter/TRAIT.md");
  });

  test("多层名（带 / 嵌套）保留结构", () => {
    expect(
      resolveVirtualPath("@trait:kernel/talkable/relation_update", {
        rootDir,
        selfName,
      }),
    ).toBe("/root/kernel/traits/talkable/relation_update/TRAIT.md");
  });

  test("未知 namespace → null", () => {
    expect(
      resolveVirtualPath("@trait:unknown/x", { rootDir, selfName }),
    ).toBeNull();
  });

  test("@trait: 后缺少 namespace 或 name → null", () => {
    expect(resolveVirtualPath("@trait:", { rootDir, selfName })).toBeNull();
    expect(resolveVirtualPath("@trait:kernel", { rootDir, selfName })).toBeNull();
    expect(resolveVirtualPath("@trait:kernel/", { rootDir, selfName })).toBeNull();
  });
});

describe("resolveVirtualPath — @relation:", () => {
  const rootDir = "/root";
  const selfName = "alice";

  test("stone 场景 → stones/<self>/relations/<peer>.md", () => {
    expect(
      resolveVirtualPath("@relation:sophia", {
        rootDir,
        selfName,
        selfKind: "stone",
      }),
    ).toBe("/root/stones/alice/relations/sophia.md");
  });

  test("flow obj 场景 → flows/<sid>/objects/<self>/relations/<peer>.md", () => {
    expect(
      resolveVirtualPath("@relation:sophia", {
        rootDir,
        selfName: "tmp_obj",
        selfKind: "flow_obj",
        sessionId: "s_001",
      }),
    ).toBe("/root/flows/s_001/objects/tmp_obj/relations/sophia.md");
  });

  test("peer 名留空 → null", () => {
    expect(
      resolveVirtualPath("@relation:", { rootDir, selfName }),
    ).toBeNull();
  });
});

describe("resolveVirtualPath — 普通路径", () => {
  const rootDir = "/root";
  const selfName = "alice";

  test("非 @ 开头原样返回（调用方自行相对 rootDir）", () => {
    expect(
      resolveVirtualPath("docs/gene.md", { rootDir, selfName }),
    ).toBe("/root/docs/gene.md");
  });

  test("绝对路径原样返回", () => {
    expect(
      resolveVirtualPath("/tmp/x.md", { rootDir, selfName }),
    ).toBe("/tmp/x.md");
  });

  test("空串 → null", () => {
    expect(resolveVirtualPath("", { rootDir, selfName })).toBeNull();
  });
});

describe("resolveVirtualPath — 未知虚拟前缀", () => {
  test("@unknown:x → null（不认识的虚拟前缀返回 null）", () => {
    expect(
      resolveVirtualPath("@unknown:x", { rootDir: "/root", selfName: "alice" }),
    ).toBeNull();
  });
});
