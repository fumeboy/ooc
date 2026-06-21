import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, test } from "bun:test";
import { runBashExec } from "@ooc/builtins/terminal/terminal_process/executable/index.js";
import { runInterpreterExec } from "@ooc/builtins/interpreter/interpreter_process/executable/index.js";
import { Class as TerminalProcessClass } from "@ooc/builtins/terminal/terminal_process";
import { Class as InterpreterProcessClass } from "@ooc/builtins/interpreter/interpreter_process";
import type { Data as TerminalProcessData } from "@ooc/builtins/terminal/terminal_process";
import { createStoneObject, ensureStoneRepo } from "../../persistable";
import { writeSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import { clearServerLoaderCache } from "@ooc/core/runtime/server-loader";
import { makeThread } from "../../__tests__/make-thread";

/**
 * Wave 4 对象模型：terminal / interpreter 是 tool-object，run 经 ctx.runtime.instantiate 委托
 * 到 terminal_process / interpreter_process 的 `Class.construct`——构造首条 exec（结果进
 * history）后返回纯 Data（runtime 据此建窗）。旧 `{ ok, window }` 返回形态 + 单参
 * `executeTerminalRun({thread,args})` + ContextWindow union `TerminalProcessWindow` 均已退役。
 *
 * runBashExec(thread, code) / runInterpreterExec(thread, lang, code) 是 construct 与对应 process
 * window.exec object method 共用的运行时，签名不变。
 */

/** 最小 ConstructorContext / ExecutableContext stub（construct / exec 只用到 thread + reportDataEdit）。 */
function ctxOf(thread: ReturnType<typeof makeThread>) {
  return { thread, runtime: undefined, args: {}, reportDataEdit: async () => {} } as never;
}

describe("terminal_process runtime — runBashExec", () => {
  it("returns formatted result for a successful bash exec", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runBashExec(thread, "echo hello");
    expect(rec.ok).toBe(true);
    expect(rec.output).toContain("$ echo hello");
    expect(rec.output).toContain("[stdout]");
    expect(rec.output).toContain("hello");
    expect(rec.output).toContain("[exit 0]");
  });

  it("captures non-zero exit code", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runBashExec(thread, "exit 7");
    expect(rec.output).toContain("[exit 7]");
  });

  it("captures stderr", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runBashExec(thread, "echo bad >&2; exit 1");
    expect(rec.output).toContain("[stderr]");
    expect(rec.output).toContain("bad");
    expect(rec.output).toContain("[exit 1]");
  });

  it("truncates oversize stdout", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runBashExec(thread, "head -c 8192 /dev/zero | tr '\\0' 'a'");
    expect(rec.output).toContain("...[truncated, original");
  });

  it("rejects missing bash code", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runBashExec(thread, undefined);
    expect(rec.output).toContain("缺少 code 参数");
    expect(rec.ok).toBe(false);
  });

  it("injects OOC_SELF_DIR pointing at session worktree for business session", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-shell-self-"));
    try {
      await ensureStoneRepo({ baseDir: tempRoot });
      await createStoneObject({ baseDir: tempRoot, objectId: "agent", _stonesBranch: "main" });
      await writeSelf({ baseDir: tempRoot, objectId: "agent", _stonesBranch: "main" }, "# Agent\n");
      const mainDir = join(tempRoot, "stones", "main");
      Bun.spawnSync(["git", "add", "-A"], { cwd: mainDir });
      Bun.spawnSync(
        ["git", "-c", "user.name=t", "-c", "user.email=t@ooc.local", "commit", "-m", "seed"],
        { cwd: mainDir },
      );

      const thread = makeThread({
        id: "t",
        persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "agent", threadId: "t" },
      });
      const rec = await runBashExec(thread, "echo \"$OOC_SELF_DIR\"");
      expect(rec.output).toContain(`${tempRoot}/flows/s1/objects/agent`);
      expect(rec.output).toContain("[exit 0]");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not set OOC_SELF_DIR when thread has no persistence", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runBashExec(thread, "echo \"[${OOC_SELF_DIR:-UNSET}]\"");
    expect(rec.output).toContain("[UNSET]");
  });
});

describe("interpreter_process runtime — runInterpreterExec (ts/js)", () => {
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
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "agent", threadId: "t" },
    });
    const rec = await runInterpreterExec(thread, "ts", "_result_ = 2 + 3;", {});
    expect(rec.output).toContain("[returnValue]");
    expect(rec.output).toContain("5");
    expect(rec.output).toContain("[exit 0]");
  });

  test("ts mode injects self with stone dir", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "agent", threadId: "t" },
    });
    const rec = await runInterpreterExec(thread, "ts", "_result_ = self.dir;", {});
    expect(rec.output).toContain("agent");
  });

  test("ts mode getThreadLocal/setThreadLocal share state across exec", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "agent", threadId: "t" },
    });
    await runInterpreterExec(thread, "ts", "self.setThreadLocal('counter', 1);", {});
    const second = await runInterpreterExec(thread, "ts", "_result_ = self.getThreadLocal('counter');", {});
    expect(second.output).toContain("[returnValue]");
    expect(second.output).toContain("1");
  });

  test("ts mode getData/setData read/write the instance userData + trigger reportDataEdit", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "agent", threadId: "t" },
    });
    // 同一 userData 引用串两次 exec：setData 写、getData 读，落在实例自身 data 上（非草稿文件）。
    const userData: Record<string, unknown> = {};
    let edits = 0;
    const reportDataEdit = async () => { edits += 1; };
    await runInterpreterExec(thread, "ts", "await self.setData('k', 42);", userData, undefined, reportDataEdit);
    expect(userData.k).toBe(42);
    expect(edits).toBe(1);
    const second = await runInterpreterExec(thread, "ts", "_result_ = await self.getData('k');", userData, undefined, reportDataEdit);
    expect(second.output).toContain("[returnValue]");
    expect(second.output).toContain("42");
  });
});

describe("terminal_process.construct builds first exec into history", () => {
  it("returns Data with history[0] of the successful bash exec", async () => {
    const thread = makeThread({ id: "t" });
    const data = (await TerminalProcessClass.construct!.exec(ctxOf(thread), { code: "echo hello" })) as TerminalProcessData;
    expect(data.history).toHaveLength(1);
    expect(data.history[0]?.output).toContain("hello");
    expect(data.history[0]?.ok).toBe(true);
  });

  it("throws when code is missing (runtime catches → no window built)", async () => {
    const thread = makeThread({ id: "t" });
    await expect(TerminalProcessClass.construct!.exec(ctxOf(thread), {})).rejects.toThrow(/缺少 code/);
  });
});

describe("interpreter_process.construct builds first exec into history", () => {
  it("returns Data with history[0] for ts code", async () => {
    const thread = makeThread({ id: "t" });
    const data = (await InterpreterProcessClass.construct!.exec(ctxOf(thread), {
      language: "ts",
      code: "_result_ = 1 + 1;",
    })) as { history: unknown[] };
    expect(data.history).toHaveLength(1);
  });
});

describe("terminal_process.exec object method — missing-args error path", () => {
  it("returns reopen-hint error string when code is missing", async () => {
    const thread = makeThread({ id: "t_pw_exec_no_args" });
    const execMethod = TerminalProcessClass.executable!.methods.find((m) => m.name === "exec")!;
    const self: TerminalProcessData = { history: [] };
    const result = await execMethod.exec(ctxOf(thread), self, {});
    expect(typeof result).toBe("string");
    expect(result as string).toContain("缺少 code 参数");
    expect(result as string).toContain("exec");
  });
});
