import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, writeServerSource } from "../../persistable";
import { clearServerLoaderCache, loadServerMethods, loadUiServerMethods } from "../server/loader";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearServerLoaderCache();
});

describe("loadServerMethods", () => {
  test("returns empty when server/index.ts missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });
    const methods = await loadServerMethods(ref);
    expect(methods).toEqual({});
  });

  test("loads llm_methods from server/index.ts", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeServerSource(
      ref,
      `export const llm_methods = {
        echo: {
          description: "回声",
          params: [{ name: "text", type: "string", required: true }],
          fn: async (_ctx, { text }) => text,
        },
      };`
    );

    const methods = await loadServerMethods(ref);
    expect(Object.keys(methods)).toEqual(["echo"]);
    const result = await methods.echo!.fn({} as never, { text: "hi" });
    expect(result).toBe("hi");
  });

  test("reloads when server/index.ts mtime changes", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeServerSource(ref, `export const llm_methods = { v1: { fn: async () => 1 } };`);
    let methods = await loadServerMethods(ref);
    expect(Object.keys(methods)).toEqual(["v1"]);

    await new Promise((r) => setTimeout(r, 5));
    await writeServerSource(ref, `export const llm_methods = { v2: { fn: async () => 2 } };`);

    methods = await loadServerMethods(ref);
    expect(Object.keys(methods)).toEqual(["v2"]);
  });

  test("loads ui_methods from server/index.ts", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeServerSource(
      ref,
      `export const ui_methods = {
        submit: {
          fn: async (_ctx, { value }) => ({ ok: value }),
        },
      };`
    );

    const methods = await loadUiServerMethods(ref);
    expect(Object.keys(methods)).toEqual(["submit"]);
  });
});
