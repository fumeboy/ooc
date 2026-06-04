import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, stoneDir } from "../stone-object";
import { createFlowObject } from "../flow-object";
import { objectDir } from "../common";
import {
  flowClientPageFile,
  flowClientPagesDir,
  readFlowClientPage,
  readVisibleSource,
  writeFlowClientPage,
  writeVisibleSource,
  visibleIndexFile,
} from "../stone-client";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("stone visible persistable", () => {
  test("stone visible/index.tsx round trip (canonical)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-client-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alan" });

    expect(await readVisibleSource(ref)).toBeUndefined();
    expect(visibleIndexFile(ref)).toBe(join(stoneDir(ref), "visible", "index.tsx"));

    const tsx = `export default function View() { return <div>hi</div>; }`;
    await writeVisibleSource(ref, tsx);
    expect(await readVisibleSource(ref)).toBe(tsx);
    // 迁移完成：writeVisibleSource 不再双写 client/
    await expect(stat(join(stoneDir(ref), "client", "index.tsx"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("stone writeVisibleSource creates visible/ if missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-client-"));
    // 不调 createStoneObject —— 直接写盘也得过
    const ref = { baseDir: tempRoot, objectId: "no-skeleton" };
    await writeVisibleSource(ref, "x");
    const stats = await stat(join(stoneDir(ref), "visible", "index.tsx"));
    expect(stats.isFile()).toBe(true);
  });
});

describe("flow client pages persistable", () => {
  test("flow page round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-client-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "alan",
    });

    expect(await readFlowClientPage(ref, "report")).toBeUndefined();
    expect(flowClientPagesDir(ref)).toBe(join(objectDir(ref), "client", "pages"));
    expect(flowClientPageFile(ref, "report")).toBe(
      join(objectDir(ref), "client", "pages", "report.tsx"),
    );

    const tsx = `export default function Report() { return <div>r</div>; }`;
    await writeFlowClientPage(ref, "report", tsx);
    expect(await readFlowClientPage(ref, "report")).toBe(tsx);
  });

  test("flow writeFlowClientPage creates pages/ if missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-client-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s2",
      objectId: "alan",
    });
    await writeFlowClientPage(ref, "p1", "x");
    const stats = await readFile(
      join(objectDir(ref), "client", "pages", "p1.tsx"),
      "utf8",
    );
    expect(stats).toBe("x");
  });

  test("flow page name validation rejects unsafe names", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-client-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s3",
      objectId: "alan",
    });
    expect(() => flowClientPageFile(ref, "../escape")).toThrow();
    expect(() => flowClientPageFile(ref, "with space")).toThrow();
    expect(() => flowClientPageFile(ref, "x.tsx")).toThrow();
    expect(() => flowClientPageFile(ref, "")).toThrow();
  });
});
