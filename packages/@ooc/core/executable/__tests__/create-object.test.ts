/**
 * create_object —— 建新对象原语端到端验证（去 metaprog 后补回的「建对象」路径）。
 *
 * 回归背景：去 metaprog 删了 supervisorCreateObject，write_file 又只能改「已存在对象」
 * （靠 package.json 判 owner 边界，新对象没 package.json → 拒），导致建新对象路径完全断。
 * create_object（落 session worktree，不 commit）补回；本测验证：
 *  (a) 业务 session create_object → 骨架落 flows/<sid>/objects/<newId>/{package.json,self.md,readable.md[,knowledge]}，内容正确；
 *  (b) main 仍无该对象（未合入）；
 *  (c) ALREADY_EXISTS（main 已存在 / 同 session 重复建）/ super-session 拒 / 非空校验 / 非法 id；
 *  (d) 地基不变量：session 新对象天生 ephemeral——session worktree 永不合入 main；
 *      进 canonical 走独立 feat-branch PR（super(foo) new_feat_branch + 直接编辑 + create_pr_and_invite_reviewers）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests } from "@ooc/core/persistable";
import { readSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import { executeCreateObject } from "@ooc/builtins/runtime/executable/index.js";
import { executeCreatePrAndInviteReviewers } from "@ooc/builtins/agent/thread/executable/method.create-pr-and-invite-reviewers.js";
import { executeNewFeatBranch } from "@ooc/builtins/agent/thread/executable/method.new-feat-branch.js";
import { construct as fileConstruct } from "@ooc/builtins/filesystem/file/executable/construct.js";
import type {
  ExecutableContext,
  ConstructorContext,
} from "@ooc/core/executable/contract.js";

/**
 * Wave4 后 write_file 是 file class 的 construct 分支（args 带 content → 写 worktree）。
 * 旧的独立 writeFileExec 已退役，写盘逻辑下沉到 file construct——这里直接驱动 construct.exec
 * 模拟 super(foo) 在 feat 绑定下用 write_file 落 feat worktree。
 */
async function executeWriteFileMethod(ctx: { persistence?: unknown; ownerThread?: unknown; args: Record<string, unknown> }): Promise<{ ok: true; path: string }> {
  const data = await fileConstruct.exec(
    { persistence: ctx.persistence, ownerThread: ctx.ownerThread, args: ctx.args } as unknown as ConstructorContext,
    ctx.args,
  );
  return { ok: true, path: (data as { path: string }).path };
}

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());
afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
});

async function newWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "_test_persistable_create-object-"));
  tempRoots.push(baseDir);
  for (const id of [...agents, "supervisor"]) {
    await mkdir(join(baseDir, "stones", id), { recursive: true });
    await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
    await writeFile(
      join(baseDir, "stones", id, "package.json"),
      JSON.stringify({
        name: `@ooc-obj/${id.replace(/\//g, "-")}`,
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: id, kind: "object", type: "agent" },
      }),
      "utf8",
    );
  }
  await ensureStoneRepo({ baseDir });
  return baseDir;
}

/** 业务 session ctx（create_object 落 worktree）。 */
function bizCtx(baseDir: string, objectId: string, sessionId: string, args: Record<string, unknown>) {
  const persistence = { baseDir, objectId, sessionId, threadId: "t" };
  return {
    persistence,
    thread: { persistence, contextWindows: [], events: [] },
    args,
  } as unknown as ExecutableContext;
}

/** super(foo) ctx：super flow，objectId=foo。 */
function superCtx(baseDir: string, objectId: string, args: Record<string, unknown>) {
  const persistence = { baseDir, objectId, sessionId: "super", threadId: "tS" };
  return {
    persistence,
    thread: { persistence, contextWindows: [], events: [] },
    args,
  } as unknown as ExecutableContext;
}

/** create_object exec 是三参 (ctx, self, args)；测试直接驱动。 */
function runCreateObject(ctx: ExecutableContext) {
  return executeCreateObject(ctx, undefined as never, ctx.args);
}

function wtObjDir(baseDir: string, sid: string, id: string): string {
  return join(baseDir, "flows", sid, "objects", id);
}
function mainObjDir(baseDir: string, id: string): string {
  return join(baseDir, "stones", "main", "objects", id);
}

describe("create_object (建新对象原语)", () => {
  test("(a)(b) 业务 session 建对象 → 骨架落 session worktree，内容正确，main 未合入", async () => {
    const baseDir = await newWorld(["alice"]);

    const out = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", {
        objectId: "report-writer",
        selfMd: "# report-writer\n我是 report-writer。\n",
        readableMd: "# report-writer\n何时找我：写报告。\n",
        knowledge: { "usage.md": "# 用法\n...\n" },
      }),
    );
    expect(typeof out).toBe("string");
    const res = JSON.parse(out as string);
    expect(res.ok).toBe(true);
    expect(res.objectId).toBe("report-writer");
    expect(typeof res.note).toBe("string");

    // (a) 骨架落 flows/s1/objects/report-writer/，内容正确
    const wt = wtObjDir(baseDir, "s1", "report-writer");
    const pkg = JSON.parse(await readFile(join(wt, "package.json"), "utf8"));
    expect(pkg.ooc.objectId).toBe("report-writer");
    expect(pkg.ooc.kind).toBe("object");
    expect(await readFile(join(wt, "self.md"), "utf8")).toBe("# report-writer\n我是 report-writer。\n");
    expect(await readFile(join(wt, "readable.md"), "utf8")).toBe("# report-writer\n何时找我：写报告。\n");
    expect(await readFile(join(wt, "knowledge", "usage.md"), "utf8")).toBe("# 用法\n...\n");

    // (b) main 仍无该对象（未合入）
    await expect(stat(mainObjDir(baseDir, "report-writer"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readSelf({ baseDir, objectId: "report-writer" })).toBeUndefined();
  });

  test("(c) ALREADY_EXISTS: 对象已在 main → 拒", async () => {
    const baseDir = await newWorld(["alice"]);
    // alice 已存在于 main（newWorld bootstrap）
    const out = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", {
        objectId: "alice",
        selfMd: "x\n",
        readableMd: "y\n",
      }),
    );
    expect(out).toContain("[create_object:ALREADY_EXISTS]");
    expect(out).toContain("main");
  });

  test("(c) ALREADY_EXISTS: 同 session 内重复建 → 拒", async () => {
    const baseDir = await newWorld(["alice"]);
    const first = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", { objectId: "newbie", selfMd: "a\n", readableMd: "b\n" }),
    );
    expect(JSON.parse(first as string).ok).toBe(true);
    const second = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", { objectId: "newbie", selfMd: "a2\n", readableMd: "b2\n" }),
    );
    expect(second).toContain("[create_object:ALREADY_EXISTS]");
    expect(second).toContain("worktree");
  });

  test("(c) super flow / 无 session → 拒（仅业务 session 可建）", async () => {
    const baseDir = await newWorld(["alice"]);
    const superOut = await runCreateObject(
      superCtx(baseDir, "alice", { objectId: "x", selfMd: "a\n", readableMd: "b\n" }),
    );
    expect(superOut).toContain("仅业务 session");
    // main 不被建
    await expect(stat(mainObjDir(baseDir, "x"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("(c) 非空校验：selfMd / readableMd 空 → INVALID_INPUT", async () => {
    const baseDir = await newWorld(["alice"]);
    const emptySelf = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", { objectId: "x", selfMd: "   ", readableMd: "b\n" }),
    );
    expect(emptySelf).toContain("[create_object:INVALID_INPUT]");
    expect(emptySelf).toContain("selfMd");

    const emptyReadable = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", { objectId: "x", selfMd: "a\n", readableMd: "" }),
    );
    expect(emptyReadable).toContain("[create_object:INVALID_INPUT]");
    expect(emptyReadable).toContain("readableMd");
  });

  test("(c) 非法 objectId / Builtin 冲突 → 拒", async () => {
    const baseDir = await newWorld(["alice"]);
    const bad = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", { objectId: "../escape", selfMd: "a\n", readableMd: "b\n" }),
    );
    expect(bad).toContain("[create_object:INVALID_INPUT]");

    const builtin = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", { objectId: "supervisor", selfMd: "a\n", readableMd: "b\n" }),
    );
    expect(builtin).toContain("[create_object:BUILTIN_CONFLICT]");
  });

  test("(d) session 新对象 ephemeral；进 canonical 走独立 feat-branch PR（super(foo) new_feat_branch + 直接编辑 + create_pr_and_invite_reviewers）", async () => {
    const baseDir = await newWorld(["alice"]);

    // 业务 session s1：alice 建 report-writer（落 session worktree，永不合入）
    const created = await runCreateObject(
      bizCtx(baseDir, "alice", "s1", {
        objectId: "report-writer",
        selfMd: "# report-writer\n身份\n",
        readableMd: "# report-writer\n自述\n",
      }),
    );
    expect(JSON.parse(created as string).ok).toBe(true);
    // session worktree 有，main 没有（session 永不合入）
    await expect(stat(mainObjDir(baseDir, "report-writer"))).rejects.toMatchObject({ code: "ENOENT" });

    // 进 canonical = super(alice) 经 feat-branch PR 沉淀新对象（独立路径，不碰 session）。
    // 同一可变 thread 携 feat 绑定贯穿 new_feat_branch → write_file → create_pr_and_invite_reviewers。
    const superThread = {
      persistence: { baseDir, objectId: "alice", sessionId: "super", threadId: "tS" } as Record<string, unknown>,
      contextWindows: [] as unknown[],
      events: [] as unknown[],
    };
    const ctx = (args: Record<string, unknown>) =>
      ({ ownerThread: superThread, args }) as unknown as ExecutableContext;

    await executeNewFeatBranch(ctx({ intent: "introduce report-writer" }), { intent: "introduce report-writer" });
    await executeWriteFileMethod(
      ctx({ path: "stones/report-writer/self.md", content: "# report-writer\n身份\n" }),
    );
    await executeWriteFileMethod(
      ctx({ path: "stones/report-writer/readable.md", content: "# report-writer\n自述\n" }),
    );
    // 新对象 ≠ alice 自治区 → reviewer 集含新对象 owner + supervisor。
    const out = await executeCreatePrAndInviteReviewers(ctx({}), {});
    const r = JSON.parse(out as string);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("pr-issue");
    expect(r.reviewers.sort()).toEqual(["report-writer", "supervisor"]);
    // 沉淀未合入前 main 仍无该对象（等 PR resolve）
    await expect(stat(mainObjDir(baseDir, "report-writer"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
