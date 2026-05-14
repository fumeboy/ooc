import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, test } from "bun:test";
import { executeProgramCommand } from "../commands/program";
import { createStoneObject, writeServerSource } from "../../persistable";
import { clearServerLoaderCache } from "../server/loader";
import { makeThread } from "../../__tests__/make-thread";

function makeCtx(args: Record<string, unknown>) {
  const thread = makeThread({ id: "t" });
  return { thread, args };
}

function makeCtxWithPersistence(
  args: Record<string, unknown>,
  objectId: string,
  baseDir: string,
) {
  const thread = makeThread({
    id: "t",
    persistence: { baseDir, sessionId: "s1", objectId, threadId: "t" },
  });
  return { thread, args };
}

describe("program.shell", () => {
  it("returns formatted result for a successful command", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell", code: "echo hello" }));
    expect(result).toContain("$ echo hello");
    expect(result).toContain("[stdout]");
    expect(result).toContain("hello");
    expect(result).toContain("[exit 0]");
  });

  it("captures non-zero exit code", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell", code: "exit 7" }));
    expect(result).toContain("[exit 7]");
  });

  it("captures stderr", async () => {
    const result = await executeProgramCommand(
      makeCtx({ language: "shell", code: "echo bad >&2; exit 1" })
    );
    expect(result).toContain("[stderr]");
    expect(result).toContain("bad");
    expect(result).toContain("[exit 1]");
  });

  it("truncates oversize stdout", async () => {
    const result = await executeProgramCommand(
      makeCtx({ language: "shell", code: "head -c 8192 /dev/zero | tr '\\0' 'a'" })
    );
    expect(result).toContain("...[truncated, original");
  });

  it("rejects unknown language with explicit message", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "rust", code: "fn main(){}" }));
    expect(result).toContain("未知 language");
  });

  it("rejects missing code", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell" }));
    expect(result).toContain("缺少 code 参数");
  });

  it("injects OOC_SELF_DIR pointing at stone dir when persistence is present", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-shell-self-"));
    try {
      await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
      const ctx = makeCtxWithPersistence(
        { language: "shell", code: "echo \"$OOC_SELF_DIR\"" },
        "agent",
        tempRoot
      );
      const result = await executeProgramCommand(ctx);
      expect(result).toContain(`${tempRoot}/stones/agent`);
      expect(result).toContain("[exit 0]");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not set OOC_SELF_DIR when thread has no persistence", async () => {
    const result = await executeProgramCommand(
      makeCtx({ language: "shell", code: "echo \"[${OOC_SELF_DIR:-UNSET}]\"" })
    );
    expect(result).toContain("[UNSET]");
  });
});

describe("program.ts/js + program.function", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
    clearServerLoaderCache();
  });

  test("ts mode runs user code and returns _result_", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const ctx = makeCtxWithPersistence(
      { language: "ts", code: "_result_ = 2 + 3;" },
      "agent",
      tempRoot
    );
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("[returnValue]");
    expect(result).toContain("5");
    expect(result).toContain("[exit 0]");
  });

  test("ts mode injects self with stone dir", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const ctx = makeCtxWithPersistence(
      { language: "ts", code: "_result_ = self.dir;" },
      "agent",
      tempRoot
    );
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("agent");
  });

  test("function path calls registered method", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      ref,
      `export const llm_methods = { add: { fn: async (_c, { a, b }) => a + b } };`
    );

    const ctx = makeCtxWithPersistence(
      { function: "add", args: { a: 7, b: 8 } },
      "agent",
      tempRoot
    );
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("[returnValue]");
    expect(result).toContain("15");
  });

  test("function path sees newly written server source immediately", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });

    const before = await executeProgramCommand(
      makeCtxWithPersistence({ function: "wordcount", args: { text: "a b c" } }, "agent", tempRoot)
    );
    expect(before).toContain("不存在");

    await writeServerSource(
      ref,
      `export const llm_methods = { wordcount: { fn: async (_c, { text }) => text.split(/\\s+/).length } };`
    );

    const after = await executeProgramCommand(
      makeCtxWithPersistence({ function: "wordcount", args: { text: "a b c" } }, "agent", tempRoot)
    );
    expect(after).toContain("[returnValue]");
    expect(after).toContain("3");
  });

  test("function path errors clearly when no persistence", async () => {
    const thread = makeThread({ id: "t" });
    const result = await executeProgramCommand({ thread, args: { function: "any" } });
    expect(result).toContain("无 persistence");
  });

  test("function path errors clearly when method missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const ctx = makeCtxWithPersistence({ function: "nope" }, "agent", tempRoot);
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("不存在");
  });

  test("program path suggests refine protocol when execution args are missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const ctx = makeCtxWithPersistence({}, "agent", tempRoot);
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("program form 参数不完整");
    expect(result).toContain("refine(args=");
    expect(result).toContain("language");
  });
});
