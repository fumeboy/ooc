import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, test } from "bun:test";
import { runBashExec, executeTerminalProcessExec } from "@ooc/builtins/terminal_process";
import { runInterpreterExec } from "@ooc/builtins/interpreter_process";
import { runExec as executeTerminalRun } from "@ooc/builtins/terminal/executable/index.js";
import { runExec as executeInterpreterRun } from "@ooc/builtins/interpreter/executable/index.js";
import type { TerminalProcessWindow } from "../windows/_shared/types";
import { createStoneObject, ensureStoneRepo, writeSelf } from "../../persistable";
import { clearServerLoaderCache } from "@ooc/core/runtime/server-loader";
import { makeThread } from "../../__tests__/make-thread";

/**
 * runBashExec / runInterpreterExec 是 terminal / interpreter 构造器与对应 process window.exec
 * 共用的运行时。terminal.run / interpreter.run 委托到各自 process 的 run constructor 造首 exec。
 */
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
    const rec = await runInterpreterExec(thread, "ts", "_result_ = 2 + 3;");
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
    const rec = await runInterpreterExec(thread, "ts", "_result_ = self.dir;");
    expect(rec.output).toContain("agent");
  });

  test("ts mode getThreadLocal/setThreadLocal share state across exec", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "agent", threadId: "t" },
    });
    await runInterpreterExec(thread, "ts", "self.setThreadLocal('counter', 1);");
    const second = await runInterpreterExec(thread, "ts", "_result_ = self.getThreadLocal('counter');");
    expect(second.output).toContain("[returnValue]");
    expect(second.output).toContain("1");
  });
});

describe("terminal.run constructs a terminal_process with first exec", () => {
  it("returns {ok:true, window} with history[0]", async () => {
    const thread = makeThread({ id: "t" });
    const result = await executeTerminalRun({
      thread,
      args: { code: "echo hello" },
    } as any);
    expect(typeof result).toBe("object");
    const outcome = result as { ok: true; window: TerminalProcessWindow };
    expect(outcome.ok).toBe(true);
    const win = outcome.window;
    expect(win.class).toBe("terminal_process");
    expect(win.history).toHaveLength(1);
    expect(win.history[0]?.output).toContain("hello");
    expect(win.history[0]?.ok).toBe(true);
  });

  it("returns an error outcome when code is missing", async () => {
    const thread = makeThread({ id: "t" });
    const result = await executeTerminalRun({ thread, args: {} } as any);
    expect(typeof result).toBe("object");
    expect((result as { ok: false; error: string }).ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBeDefined();
  });
});

describe("interpreter.run constructs an interpreter_process with first exec", () => {
  it("returns {ok:true, window} for ts code", async () => {
    const thread = makeThread({ id: "t" });
    const result = await executeInterpreterRun({
      thread,
      args: { language: "ts", code: "_result_ = 1 + 1;" },
    } as any);
    const outcome = result as unknown as { ok: true; window: { class: string; history: unknown[] } };
    expect(outcome.ok).toBe(true);
    expect(outcome.window.class).toBe("interpreter_process");
    expect(outcome.window.history).toHaveLength(1);
  });
});

describe("executeTerminalProcessExec missing-args error path", () => {
  it("returns reopen-hint error when code is missing", async () => {
    const thread = makeThread({ id: "t_pw_exec_no_args" });
    const window: TerminalProcessWindow = {
      id: "terminal_process_test",
      class: "terminal_process",
      parentWindowId: "root",
      title: "test",
      status: "open",
      createdAt: Date.now(),
      history: [],
    };
    const result = await executeTerminalProcessExec({
      thread,
      args: {},
      self: window,
    } as any);
    expect(typeof result).toBe("string");
    expect(result as string).toContain("缺少 code 参数");
    expect(result as string).toContain("exec");
  });
});
