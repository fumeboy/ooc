import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createFlowObject } from "../flow-object";
import { objectDir } from "../common";
import {
  flowClientPageFile,
  flowClientPagesDir,
  readFlowClientPage,
  writeFlowClientPage,
} from "../stone-client";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
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
