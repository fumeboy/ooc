/**
 * flow-scan —— `scanFlowChanges` 守门测试（issue F）。
 *
 * 3 case：
 * 1. agent classId + versionedFields=["self"] → `self` 改动入 versioned_dirty 桶。
 * 2. thread classId + versionedFields=[] → 全部改动入 unversioned_dirty 桶。
 * 3. 注册 dummy class `_test/foo` with `versioned_fields: ["x"]` 到 ClassRegistry → 经
 *    `resolveVersionedFields` 解析后 scanFlowChanges 把 x 入 versioned、其它入 unversioned。
 *
 * 关键：本测试覆盖 `scanFlowChanges` 算法层；wiring（method.reflect.ts 三处调点经
 * `getSessionRegistry(sid).resolveVersionedFields(classId)` 接通）由
 * `reflectable-redesign-issue-d.test.ts` 末段 e2e wiring assertion 兜底。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanFlowChanges } from "@ooc/core/persistable/flow-scan";
import { ClassRegistry } from "@ooc/core/runtime/object-registry";

let baseDir: string;
const SID = "test-flow-scan-session";

async function writeFlowData(
  objectId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const dir = join(baseDir, "flows", SID, "objects", objectId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "data.json"), JSON.stringify(data), "utf8");
}

async function writeStoneCanonical(
  objectId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const dir = join(baseDir, "stones", "main", "objects", objectId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "data.json"), JSON.stringify(data), "utf8");
}

describe("flow-scan scanFlowChanges (issue F)", () => {
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-flowscan-test-"));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("case 1: agent classId + versionedFields=['self'] → self 改动入 versioned_dirty 桶", async () => {
    const objectId = "agent_a";
    await writeStoneCanonical(objectId, { self: "OLD SELF", notes: "n1" });
    await writeFlowData(objectId, { self: "NEW SELF", notes: "n1" });

    const result = await scanFlowChanges(baseDir, SID, objectId, ["self"]);

    expect(result.versionedDirty.length).toBe(1);
    expect(result.versionedDirty[0]!.field).toBe("self");
    expect(result.versionedDirty[0]!.oldValue).toBe(JSON.stringify("OLD SELF"));
    expect(result.versionedDirty[0]!.newValue).toBe(JSON.stringify("NEW SELF"));
    expect(result.unversionedDirty.length).toBe(0);
  });

  it("case 2: thread classId + versionedFields=[] → 全部改动入 unversioned_dirty 桶", async () => {
    const objectId = "thread_b";
    await writeStoneCanonical(objectId, { messages: [], status: "open" });
    await writeFlowData(objectId, { messages: [{ role: "user", content: "hi" }], status: "doing" });

    const result = await scanFlowChanges(baseDir, SID, objectId, []);

    expect(result.versionedDirty.length).toBe(0);
    expect(result.unversionedDirty.length).toBe(2);
    const fields = result.unversionedDirty.map((d) => d.field).sort();
    expect(fields).toEqual(["messages", "status"]);
  });

  it("case 3: dummy class with versioned_fields:['x'] via ClassRegistry → x 入 versioned、其它入 unversioned", async () => {
    const registry = new ClassRegistry();
    registry.register({
      id: "_test/foo",
      versioned_fields: ["x"] as const,
    });

    const versionedFields = registry.resolveVersionedFields("_test/foo");
    expect(versionedFields).toEqual(["x"]);

    const objectId = "foo_obj";
    await writeStoneCanonical(objectId, { x: 1, y: 2, z: 3 });
    await writeFlowData(objectId, { x: 99, y: 2, z: 42 });

    const result = await scanFlowChanges(baseDir, SID, objectId, versionedFields);

    expect(result.versionedDirty.length).toBe(1);
    expect(result.versionedDirty[0]!.field).toBe("x");
    expect(result.versionedDirty[0]!.newValue).toBe("99");

    expect(result.unversionedDirty.length).toBe(1);
    expect(result.unversionedDirty[0]!.field).toBe("z");
    expect(result.unversionedDirty[0]!.newValue).toBe("42");
  });
});
