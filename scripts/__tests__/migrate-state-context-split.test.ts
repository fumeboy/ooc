/**
 * Tests for scripts/migrate-state-context-split.ts (dual migration).
 *
 * Spawns the migration as a child bun process against a synthesized legacy
 * world tree, then asserts the on-disk shape afterwards. We don't import the
 * script directly: it uses top-level await + process.exit, and shelling it
 * out also covers the CLI surface.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "migrate-state-context-split.ts");

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(p: string, v: unknown) {
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf8")) as T;
}

async function runMigration(world: string, extra: string[] = []): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", SCRIPT, "--world", world, ...extra], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("migrate-state-context-split", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "ooc-migrate-test-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("is a no-op on an empty world", async () => {
    const { exitCode, stdout } = await runMigration(tmp);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bogus built-in feature dirs removed   : 0");
    expect(stdout).toContain("state.json contextWindows stripped    : 0");
  });

  it("strips contextWindows from independent flow-object state.json and lifts entries into thread-context.json", async () => {
    const sid = "_test_session_1";
    const oid = "supervisor";
    const tid = "t_main";
    const sup = join(tmp, "flows", sid, oid);

    await writeJson(join(sup, "state.json"), {
      id: oid,
      type: "supervisor",
      title: "Supervisor",
      status: "active",
      createdAt: 1,
      // legacy: contextWindows mistakenly persisted on object state
      contextWindows: [
        { id: "w_talk_a", type: "talk", title: "talk-a", status: "open", createdAt: 2, parentWindowId: "root", target: "user", conversationId: "w_talk_a" },
      ],
    });
    await writeJson(join(sup, ".flow.json"), { type: "flow-object", sessionId: sid, objectId: oid });
    await mkdir(join(sup, "threads", tid), { recursive: true });

    const { exitCode, stdout } = await runMigration(tmp);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("state.json contextWindows stripped    : 1");
    expect(stdout).toContain("context entries moved                  : 1");

    const state = await readJson<Record<string, unknown>>(join(sup, "state.json"));
    expect("contextWindows" in state).toBe(false);
    expect(state.id).toBe(oid);
    expect(state.type).toBe("supervisor");

    const ctx = await readJson<{ threadId: string; contextWindows: any[] }>(
      join(sup, "threads", tid, "thread-context.json"),
    );
    expect(ctx.contextWindows).toHaveLength(1);
    expect(ctx.contextWindows[0]!.id).toBe("w_talk_a");
    expect(ctx.contextWindows[0]!.type).toBe("talk");
  });

  it("removes bogus built-in feature dirs and inlines entries into the referencing thread-context.json", async () => {
    const sid = "_test_session_2";
    const supId = "supervisor";
    const formId = "f_form123";
    const tid = "t_main";
    const sup = join(tmp, "flows", sid, supId);
    const formDir = join(tmp, "flows", sid, formId);

    // legacy: form persisted as its own flow object dir
    await writeJson(join(formDir, "state.json"), {
      id: formId,
      type: "method_exec",
      title: "talk form",
      status: "open",
      createdAt: 5,
      parentWindowId: "root",
      command: "talk",
      description: "open a talk_window with the user",
      accumulatedArgs: { target: "user" },
      commandPaths: ["talk"],
      loadedKnowledgePaths: [],
    });

    // supervisor with thread-context.json that references the form by id
    await writeJson(join(sup, "state.json"), {
      id: supId,
      type: "supervisor",
      title: "Supervisor",
      status: "active",
      createdAt: 1,
    });
    await writeJson(join(sup, ".flow.json"), { type: "flow-object", sessionId: sid, objectId: supId });
    await writeJson(join(sup, "threads", tid, "thread-context.json"), {
      threadId: tid,
      contextWindows: [
        { id: formId, type: "method_exec", _ref: true, refObjectId: formId },
      ],
    });

    const { exitCode, stdout } = await runMigration(tmp);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bogus built-in feature dirs removed   : 1");
    expect(stdout).toContain("built-in feature entries inlined      : 1");

    expect(await pathExists(formDir)).toBe(false);

    const ctx = await readJson<{ contextWindows: any[] }>(
      join(sup, "threads", tid, "thread-context.json"),
    );
    expect(ctx.contextWindows).toHaveLength(1);
    const entry = ctx.contextWindows[0]!;
    expect(entry.id).toBe(formId);
    expect(entry.type).toBe("method_exec");
    expect(entry._ref).toBeUndefined(); // ref replaced by inline state
    expect(entry.command).toBe("talk");
    expect(entry.accumulatedArgs).toEqual({ target: "user" });
  });

  it("falls back to appending to the first real object's first thread when no thread references the bogus dir", async () => {
    const sid = "_test_session_3";
    const supId = "supervisor";
    const orphanId = "f_orphan";
    const tid = "t_main";
    const sup = join(tmp, "flows", sid, supId);
    const orphanDir = join(tmp, "flows", sid, orphanId);

    await writeJson(join(orphanDir, "state.json"), {
      id: orphanId,
      type: "talk",
      title: "orphan",
      status: "open",
      createdAt: 5,
      parentWindowId: "root",
      target: "user",
      conversationId: orphanId,
    });

    await writeJson(join(sup, "state.json"), {
      id: supId,
      type: "supervisor",
      title: "Supervisor",
      status: "active",
      createdAt: 1,
    });
    await writeJson(join(sup, ".flow.json"), { type: "flow-object", sessionId: sid, objectId: supId });
    await writeJson(join(sup, "threads", tid, "thread-context.json"), {
      threadId: tid,
      contextWindows: [],
    });

    const { exitCode, stdout } = await runMigration(tmp);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bogus built-in feature dirs removed   : 1");

    expect(await pathExists(orphanDir)).toBe(false);

    const ctx = await readJson<{ contextWindows: any[] }>(
      join(sup, "threads", tid, "thread-context.json"),
    );
    expect(ctx.contextWindows).toHaveLength(1);
    expect(ctx.contextWindows[0]!.id).toBe(orphanId);
    expect(ctx.contextWindows[0]!.type).toBe("talk");
  });

  it("is idempotent — re-running on already-clean world is a no-op", async () => {
    const sid = "_test_session_4";
    const supId = "supervisor";
    const tid = "t_main";
    const sup = join(tmp, "flows", sid, supId);

    await writeJson(join(sup, "state.json"), {
      id: supId,
      type: "supervisor",
      title: "Supervisor",
      status: "active",
      createdAt: 1,
      contextWindows: [
        { id: "w_talk_x", type: "talk", title: "talk-x", status: "open", createdAt: 2, parentWindowId: "root", target: "user", conversationId: "w_talk_x" },
      ],
    });
    await writeJson(join(sup, ".flow.json"), { type: "flow-object", sessionId: sid, objectId: supId });
    await mkdir(join(sup, "threads", tid), { recursive: true });

    const first = await runMigration(tmp);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("state.json contextWindows stripped    : 1");

    const second = await runMigration(tmp);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("bogus built-in feature dirs removed   : 0");
    expect(second.stdout).toContain("state.json contextWindows stripped    : 0");
    expect(second.stdout).toContain("context entries moved                  : 0");
  });

  it("dry-run does not modify any files", async () => {
    const sid = "_test_session_5";
    const supId = "supervisor";
    const tid = "t_main";
    const sup = join(tmp, "flows", sid, supId);

    const stateBefore = {
      id: supId,
      type: "supervisor",
      title: "Supervisor",
      status: "active",
      createdAt: 1,
      contextWindows: [
        { id: "w_talk_x", type: "talk", title: "talk-x", status: "open", createdAt: 2, parentWindowId: "root", target: "user", conversationId: "w_talk_x" },
      ],
    };
    await writeJson(join(sup, "state.json"), stateBefore);
    await writeJson(join(sup, ".flow.json"), { type: "flow-object", sessionId: sid, objectId: supId });
    await mkdir(join(sup, "threads", tid), { recursive: true });

    const { exitCode, stdout } = await runMigration(tmp, ["--dry-run"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[DRY RUN]");

    const stateAfter = await readJson<Record<string, unknown>>(join(sup, "state.json"));
    expect(stateAfter).toEqual(stateBefore);

    expect(await pathExists(join(sup, "threads", tid, "thread-context.json"))).toBe(false);
  });
});
