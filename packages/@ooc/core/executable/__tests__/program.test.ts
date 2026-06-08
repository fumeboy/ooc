import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, test } from "bun:test";
import { runOneExec } from "@ooc/builtins/program";
import { executeProgramMethod } from "@ooc/builtins/root/executable/method.program";
import { executeProgramWindowExec } from "@ooc/builtins/program";
import type { ProgramWindow } from "../windows/_shared/types";
import { createStoneObject, writeExecutableSource, ensureStoneRepo, writeSelf } from "../../persistable";
import { clearServerLoaderCache } from "@ooc/core/runtime/server-loader";
import { makeThread } from "../../__tests__/make-thread";

/**
 * Step 2 (spec 2026-05-14)：runOneExec 是 root.program 与 program_window.exec 共用的运行时。
 * 大量原本针对 executeProgramMethod 的"返回 string"断言都迁移到 runOneExec 上的 record.output。
 *
 * executeProgramMethod 现在的副作用是创建 program_window；保留少量集成型断言以验证 window 的产生。
 */
describe("program runtime — runOneExec (shell)", () => {
  it("returns formatted result for a successful shell exec", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runOneExec(thread, { language: "shell", code: "echo hello" });
    expect(rec.ok).toBe(true);
    expect(rec.output).toContain("$ echo hello");
    expect(rec.output).toContain("[stdout]");
    expect(rec.output).toContain("hello");
    expect(rec.output).toContain("[exit 0]");
  });

  it("captures non-zero exit code", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runOneExec(thread, { language: "shell", code: "exit 7" });
    expect(rec.output).toContain("[exit 7]");
  });

  it("captures stderr", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runOneExec(thread, { language: "shell", code: "echo bad >&2; exit 1" });
    expect(rec.output).toContain("[stderr]");
    expect(rec.output).toContain("bad");
    expect(rec.output).toContain("[exit 1]");
  });

  it("truncates oversize stdout", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runOneExec(thread, {
      language: "shell",
      code: "head -c 8192 /dev/zero | tr '\\0' 'a'",
    });
    expect(rec.output).toContain("...[truncated, original");
  });

  it("rejects unknown language", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runOneExec(thread, { language: "rust" as never, code: "fn main(){}" });
    expect(rec.output).toContain("未知 language");
    expect(rec.ok).toBe(false);
  });

  it("rejects missing shell code", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runOneExec(thread, { language: "shell" });
    expect(rec.output).toContain("缺少 code 参数");
    expect(rec.ok).toBe(false);
  });

  it("injects OOC_SELF_DIR pointing at session worktree for business session", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-shell-self-"));
    try {
      // worktree 模型：identity 须先 commit 到 main，business session 的 OOC_SELF_DIR
      // 才能建 worktree 并指向 flows/<sid>/objects/<id>/（方案 A，完整副本，裸读裸写）。
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
      const rec = await runOneExec(thread, { language: "shell", code: "echo \"$OOC_SELF_DIR\"" });
      // business session → worktree object 目录（design §2 program shell 通道）。
      expect(rec.output).toContain(`${tempRoot}/flows/s1/objects/agent`);
      expect(rec.output).toContain("[exit 0]");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not set OOC_SELF_DIR when thread has no persistence", async () => {
    const thread = makeThread({ id: "t" });
    const rec = await runOneExec(thread, {
      language: "shell",
      code: "echo \"[${OOC_SELF_DIR:-UNSET}]\"",
    });
    expect(rec.output).toContain("[UNSET]");
  });
});

describe("program runtime — runOneExec (ts/js + function)", () => {
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
    const rec = await runOneExec(thread, { language: "ts", code: "_result_ = 2 + 3;" });
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
    const rec = await runOneExec(thread, { language: "ts", code: "_result_ = self.dir;" });
    expect(rec.output).toContain("agent");
  });

  test("ts mode getThreadLocal/setThreadLocal share state across exec", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "agent", threadId: "t" },
    });
    await runOneExec(thread, { language: "ts", code: "self.setThreadLocal('counter', 1);" });
    const second = await runOneExec(thread, {
      language: "ts",
      code: "_result_ = self.getThreadLocal('counter');",
    });
    expect(second.output).toContain("[returnValue]");
    expect(second.output).toContain("1");
  });
});

describe("executeProgramMethod creates a program_window with first exec", () => {
  it("attaches program_window to thread.contextWindows with history[0]", async () => {
    const thread = makeThread({ id: "t" });
    const result = await executeProgramMethod({
      thread,
      args: { language: "shell", code: "echo hello" },
    });
    // P6.§4-§5: root.program 是 constructor 委托——返回 {ok:true, object: programWindow}
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    const outcome = result as { ok: true; object: ProgramWindow };
    expect(outcome.ok).toBe(true);
    const win = outcome.object;
    expect(win.type).toBe("program");
    expect(win.history).toHaveLength(1);
    expect(win.history[0]?.output).toContain("hello");
    expect(win.history[0]?.ok).toBe(true);
  });

  it("returns an error outcome when args are incomplete (manager keeps form executed)", async () => {
    const thread = makeThread({ id: "t" });
    const result = await executeProgramMethod({ thread, args: {} });
    // P6.§4-§5: 缺参直接返回 {ok:false, error: string}（不再是直接 string）
    expect(typeof result).toBe("object");
    expect((result as { ok: false; error: string }).ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBeDefined();
    expect(thread.contextWindows.find((w) => w.type === "program")).toBeUndefined();
  });
});

describe("executeProgramWindowExec missing-args error path", () => {
  it("returns close+reopen-hint error when both language+code and function are missing", async () => {
    const thread = makeThread({ id: "t_pw_exec_no_args" });
    const programWindow: ProgramWindow = {
      id: "program_test",
      type: "program",
      parentWindowId: "root",
      title: "test",
      status: "open",
      createdAt: Date.now(),
      history: [],
    };
    const result = await executeProgramWindowExec({
      thread,
      args: {},
      self: programWindow,
    });
    expect(typeof result).toBe("string");
    expect(result as string).toContain("缺少执行参数");
    expect(result as string).toContain("exec");
    expect(result as string).toContain("language");
  });
});
