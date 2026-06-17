/**
 * createFlowObject 接受 opts.class，写入 .flow.json 的 class 字段。
 * - opts.class 指向已注册 string → 写入成功，class 字段入盘。
 * - opts.class 指向未注册 type → 抛 ClassNotFoundError（fail-loud：避免 method 解析悬空）。
 * - 不传 opts → 兼容旧调用，.flow.json 不含 class 字段。
 *
 * Wave4：class 校验经 `registry.has(classId)`（单跳继承注册表）。本测试注册一个
 * 临时 class 验证 happy-path，不依赖任何具体 builtin 名（旧 "plan" class 已不存在）。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ClassNotFoundError, createFlowObject, flowMetadataFile } from "../flow-object";
import { builtinRegistry } from "../../runtime/object-registry";

const TEST_CLASS = "_test_flow_object_class";

describe("createFlowObject + class", () => {
  let tempRoot: string;
  beforeAll(() => {
    // 注册一个最小 class 到默认 registry（createFlowObject 用 builtinRegistry），
    // 让 opts.class 命中 has() 走 happy-path。
    builtinRegistry.register(TEST_CLASS, { persistable: { mode: "inline" } });
  });
  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  test(`opts.class registered → .flow.json contains class field`, async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "p6-class-"));
    const ref = await createFlowObject(
      { baseDir: tempRoot, sessionId: "s1", objectId: "obj1" },
      { class: TEST_CLASS },
    );
    const content = JSON.parse(await readFile(flowMetadataFile(ref), "utf8"));
    expect(content.class).toBe(TEST_CLASS);
    expect(content.type).toBe("flow-object");
    expect(content.sessionId).toBe("s1");
    expect(content.objectId).toBe("obj1");
  });

  test("opts.class === \"no-such-class\" → ClassNotFoundError", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "p6-class-"));
    let caught: unknown;
    try {
      await createFlowObject(
        { baseDir: tempRoot, sessionId: "s1", objectId: "obj1" },
        { class: "no-such-class" },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClassNotFoundError);
    const err = caught as ClassNotFoundError;
    expect(err.code).toBe("CLASS_NOT_FOUND");
    expect(err.classId).toBe("no-such-class");
  });

  test("no opts → .flow.json has no class field (back-compat)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "p6-class-"));
    const ref = await createFlowObject({ baseDir: tempRoot, sessionId: "s1", objectId: "obj1" });
    const content = JSON.parse(await readFile(flowMetadataFile(ref), "utf8"));
    expect("class" in content).toBe(false);
    expect(content.type).toBe("flow-object");
  });
});
