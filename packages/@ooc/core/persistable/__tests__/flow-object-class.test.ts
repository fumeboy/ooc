/**
 * P6.§7 (2026-06-02): createFlowObject 接受 opts.class，写入 .flow.json 的 class 字段。
 * - opts.class 指向已注册 string → 写入成功，class 字段入盘。
 * - opts.class 指向未注册 type → 抛 ClassNotFoundError（fail-loud：避免 method 解析悬空）。
 * - 不传 opts → 兼容旧调用，.flow.json 不含 class 字段。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ClassNotFoundError, createFlowObject, flowMetadataFile } from "../flow-object";

describe("createFlowObject + class (P6.§7)", () => {
  let tempRoot: string;
  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  test("opts.class === \"plan\" → .flow.json contains class field", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "p6-class-"));
    const ref = await createFlowObject(
      { baseDir: tempRoot, sessionId: "s1", objectId: "obj1" },
      { class: "plan" },
    );
    const content = JSON.parse(await readFile(flowMetadataFile(ref), "utf8"));
    expect(content.class).toBe("plan");
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
