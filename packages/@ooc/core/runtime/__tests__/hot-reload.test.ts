/**
 * hot-reload.test.ts — parseStoneChange 纯函数单元测试。
 */
import { describe, expect, test } from "bun:test";
import { parseStoneChange } from "../hot-reload";

const WORLD = "/tmp/my-world";

describe("parseStoneChange 路径解析", () => {
  test("flat stone / executable/*.ts → code", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/executable/index.ts`)).toEqual({
      objectId: "alice",
      kind: "code",
    });
  });

  test("flat stone / visible/*.tsx → view", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/visible/index.tsx`)).toEqual({
      objectId: "alice",
      kind: "view",
    });
  });

  test("flat stone / knowledge/*.md → knowledge", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/knowledge/intro.md`)).toEqual({
      objectId: "alice",
      kind: "knowledge",
    });
  });

  test("self.md → identity", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/self.md`)).toEqual({
      objectId: "alice",
      kind: "identity",
    });
  });

  test("readable.md → knowledge（对齐 design doc: readable.md 归 knowledge 档）", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/readable.md`)).toEqual({
      objectId: "alice",
      kind: "knowledge",
    });
  });

  test("readable.ts → code（动态 readable 是代码）", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/readable.ts`)).toEqual({
      objectId: "alice",
      kind: "code",
    });
  });

  test("package.json → identity", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/package.json`)).toEqual({
      objectId: "alice",
      kind: "identity",
    });
  });

  test("packages/ fallback 布局也被识别", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/packages/alice/executable/index.ts`)).toEqual({
      objectId: "alice",
      kind: "code",
    });
  });

  test("不认识的子目录（如 database/、files/、pools/、flows/）→ null", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/database/data.sqlite`)).toBeNull();
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/files/x.txt`)).toBeNull();
    expect(parseStoneChange(WORLD, `${WORLD}/pools/foo/state.json`)).toBeNull();
    expect(parseStoneChange(WORLD, `${WORLD}/flows/bar/alice/state.json`)).toBeNull();
  });

  test("world 外的路径 → null", () => {
    expect(parseStoneChange(WORLD, `/other/stones/alice/self.md`)).toBeNull();
  });

  test("stones/ 根目录自身的变更（不含 stone id）→ null", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones`)).toBeNull();
    expect(parseStoneChange(WORLD, `${WORLD}/stones/.DS_Store`)).toBeNull();
  });

  test("旧 server/ 目录别名也识别为 code", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/server/index.ts`)).toEqual({
      objectId: "alice",
      kind: "code",
    });
  });

  test("旧 client/ 目录别名也识别为 view", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/alice/client/index.tsx`)).toEqual({
      objectId: "alice",
      kind: "view",
    });
  });

  test("versioning 布局 stones/<branch>/objects/<id>/executable/*.ts → code", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/main/objects/alice/executable/index.ts`)).toEqual({
      objectId: "alice",
      kind: "code",
    });
  });

  test("versioning 布局 stones/<branch>/objects/<id>/visible/*.tsx → view", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/main/objects/alice/visible/index.tsx`)).toEqual({
      objectId: "alice",
      kind: "view",
    });
  });

  test("versioning 布局 self.md → identity", () => {
    expect(parseStoneChange(WORLD, `${WORLD}/stones/feature/objects/alice/self.md`)).toEqual({
      objectId: "alice",
      kind: "identity",
    });
  });

  test("versioning 布局里 . 开头的 branch 被忽略（回退为 flat 解析，但 flat 也会失败 → null）", () => {
    // parts[1] = ".git" 以 . 开头，不识别为 branch；然后 flat 解析也找不到 id → null
    expect(parseStoneChange(WORLD, `${WORLD}/stones/.git/objects/alice/executable/index.ts`)).toBeNull();
  });
});
