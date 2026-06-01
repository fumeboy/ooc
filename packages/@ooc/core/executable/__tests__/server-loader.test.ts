import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, writeServerSource } from "../../persistable";
import { clearServerLoaderCache, loadObjectWindow, loadUiServerMethods } from "../server/loader";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearServerLoaderCache();
});

describe("loadObjectWindow", () => {
  test("returns undefined when server/index.ts missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });
    const win = await loadObjectWindow(ref);
    expect(win).toBeUndefined();
  });

  test("loads window.commands from server/index.ts", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeServerSource(
      ref,
      `export const window = {
        title: "x",
        commands: {
          echo: {
            paths: ["echo"],
            match: () => ["echo"],
            exec: async ({ args }) => ({ ok: true, result: String(args.text) }),
          },
        },
      };`
    );

    const win = await loadObjectWindow(ref);
    expect(Object.keys(win?.commands ?? {})).toEqual(["echo"]);
    const result = await win!.commands!.echo!.exec({ args: { text: "hi" } } as never);
    expect((result as { result: string }).result).toBe("hi");
  });

  test("reloads when server/index.ts mtime changes", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeServerSource(
      ref,
      `export const window = { commands: { v1: { paths: ["v1"], match: () => ["v1"], exec: async () => ({ ok: true, result: "1" }) } } };`,
    );
    let win = await loadObjectWindow(ref);
    expect(Object.keys(win?.commands ?? {})).toEqual(["v1"]);

    await new Promise((r) => setTimeout(r, 5));
    await writeServerSource(
      ref,
      `export const window = { commands: { v2: { paths: ["v2"], match: () => ["v2"], exec: async () => ({ ok: true, result: "2" }) } } };`,
    );

    win = await loadObjectWindow(ref);
    expect(Object.keys(win?.commands ?? {})).toEqual(["v2"]);
  });

  test("throws when llm_methods is present (D6 hard cutover)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });
    await writeServerSource(ref, `export const llm_methods = { foo: { fn: async () => 1 } };`);

    await expect(loadObjectWindow(ref)).rejects.toThrow(/llm_methods/);
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
