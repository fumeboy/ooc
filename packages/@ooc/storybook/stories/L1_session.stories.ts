/**
 * L1 — Session / Flow 生命周期（worktree 模型）。
 *
 * 每条只断一个预期：session 身份 = 从 stones/main 派生的 git worktree；会话产物落 flows/<sid>/。
 * 事实来源：persistable/stone-worktree.ts、flow-object.ts、thread-json.ts；modules/flows/api.*.ts。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { postJson } from "../_harness/control-plane";
import { story, check, type Story } from "../_harness/story";

/** 建一个普通 stone + 发起 session，返回 {sid, target, threadId}。session/thread 类预期的共同前置。 */
async function seedToStone(app: any, baseDir: string, target: string, sid: string) {
  await postJson(app, "/api/stones", { objectId: target, self: `# ${target}` });
  const r = await postJson(app, "/api/sessions", { sessionId: sid, targetObjectId: target, initialMessage: "hi" });
  return { status: r.status, sessionId: r.json?.sessionId, threadId: r.json?.targetThreadId as string | undefined };
}

export const L1_STORIES: Story[] = [
  story({
    id: "L1-SESSION-DIR",
    layer: "session",
    expectation: "发起 session 后 flows/<sid>/ 目录出现",
    design: "flow：session 是 flows/<sid>/ 下的运行层子树。modules/flows/api.seed-session.ts",
    run: async ({ app, baseDir }) => {
      const sid = "sb-s-dir";
      await seedToStone(app, baseDir, "obj_dir", sid);
      check(existsSync(join(baseDir, "flows", sid)), "flows/<sid> 未出现");
    },
  }),

  story({
    id: "L1-SEED-RESPONSE",
    layer: "session",
    expectation: "POST /api/sessions 返回 sessionId 与 targetThreadId",
    design: "控制面：seedSession 一次性建 session + user flow + 初始 talk + 派初始消息。api.seed-session.ts",
    run: async ({ app, baseDir }) => {
      const sid = "sb-s-resp";
      const seed = await seedToStone(app, baseDir, "obj_resp", sid);
      check(seed.status === 200, `status=${seed.status}`);
      check(seed.sessionId === sid, `sessionId=${seed.sessionId}`);
      check(!!seed.threadId, "未返回 targetThreadId");
    },
  }),

  story({
    id: "L1-SESSION-WORKTREE",
    layer: "session",
    expectation: "flows/<sid>/ 是 stones/main 派生的 git worktree（.git 是 link 文件）",
    design: "reflectable/persistable：session identity = lazy/eager git worktree 分支。stone-worktree.ts:ensureSessionWorktree",
    run: async ({ app, baseDir }) => {
      const sid = "sb-s-wt";
      await seedToStone(app, baseDir, "obj_wt", sid);
      const dotGit = join(baseDir, "flows", sid, ".git");
      check(existsSync(dotGit), "flows/<sid>/.git 不存在（未建 worktree）");
      // linked worktree 的 .git 是**文件**（gitdir 指针），而非目录；这区分它与独立 repo。
      check(statSync(dotGit).isFile(), ".git 不是 worktree link 文件（应为文件，不是目录）");
    },
  }),

  story({
    id: "L1-SESSION-META",
    layer: "session",
    expectation: "flows/<sid>/.session.json 存在且记录 sessionId",
    design: "flow：session 级运行时元数据。persistable/flow-object.ts:createFlowSession",
    run: async ({ app, baseDir }) => {
      const sid = "sb-s-meta";
      await seedToStone(app, baseDir, "obj_meta", sid);
      const p = join(baseDir, "flows", sid, ".session.json");
      check(existsSync(p), ".session.json 不存在");
      const meta = JSON.parse(readFileSync(p, "utf8"));
      check(meta.sessionId === sid, `.session.json sessionId=${meta.sessionId}`);
    },
  }),

  story({
    id: "L1-THREAD-JSON",
    layer: "session",
    expectation: "和某对象会话后 flows/<sid>/objects/<oid>/threads/<tid>/thread.json 出现",
    design: "thinkable/flow：thread 状态落 thread.json。persistable/thread-json.ts:writeThread",
    run: async ({ app, baseDir }) => {
      const sid = "sb-s-thread";
      const target = "obj_thread";
      const seed = await seedToStone(app, baseDir, target, sid);
      check(!!seed.threadId, "未拿到 threadId");
      const p = join(baseDir, "flows", sid, "objects", target, "threads", seed.threadId!, "thread.json");
      check(existsSync(p), `thread.json 不存在：${p}`);
    },
  }),

  story({
    id: "L1-THREAD-CONTEXT",
    layer: "session",
    expectation: "同一 thread 下 thread-context.json 出现（contextWindows 唯一权威）",
    design: "thinkable：contextWindows 权威落 thread-context.json，与 thread.json 分离。flow-thread-context.ts",
    run: async ({ app, baseDir }) => {
      const sid = "sb-s-ctx";
      const target = "obj_ctx";
      const seed = await seedToStone(app, baseDir, target, sid);
      const p = join(baseDir, "flows", sid, "objects", target, "threads", seed.threadId!, "thread-context.json");
      check(existsSync(p), `thread-context.json 不存在：${p}`);
    },
  }),

  story({
    id: "L1-THREAD-NO-WINDOWS",
    layer: "session",
    expectation: "thread.json 不含 contextWindows 字段（退役，单点权威分离）",
    design: "thinkable：thread.json 退役 contextWindows，避免与 thread-context.json 双写漂移。thread-json.ts",
    run: async ({ app, baseDir }) => {
      const sid = "sb-s-nowin";
      const target = "obj_nowin";
      const seed = await seedToStone(app, baseDir, target, sid);
      const p = join(baseDir, "flows", sid, "objects", target, "threads", seed.threadId!, "thread.json");
      const tj = JSON.parse(readFileSync(p, "utf8"));
      check(!("contextWindows" in tj), "thread.json 仍含 contextWindows 字段");
    },
  }),

  story({
    id: "L1-WORKTREE-GITIGNORE",
    layer: "session",
    expectation: "session worktree 继承 main 的 .gitignore（运行时产物不进 git）",
    design: "persistable：worktree 是 main HEAD 完整副本，含 .gitignore；运行时产物被黑名单。stone-worktree.ts",
    run: async ({ app, baseDir }) => {
      const sid = "sb-s-gi";
      await seedToStone(app, baseDir, "obj_gi", sid);
      const p = join(baseDir, "flows", sid, ".gitignore");
      check(existsSync(p), "session worktree 缺 .gitignore");
      check(/threads\//.test(readFileSync(p, "utf8")), ".gitignore 未黑名单 threads/");
    },
  }),
];
