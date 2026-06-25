/**
 * pr —— ooc class。reviewer 收到的 PR 评审窗。
 *
 * 流程：super(foo) 创建 feat-branch + 落 PR-Issue → runtime 实例化 pr object 投递给 reviewer →
 * reviewer agent 经 comment / approve / reject method 操作 → 触发 `onReviewerAction` finalizer。
 *
 * issue D 补全：
 * - persistable inline：PR window data 随载体 thread 落盘；持久化底座 = PR-Issue
 *   `stones/.stones_repo/.pr-issues/<id>.json`（core/persistable/pr-issue.ts）。
 * - approve / reject / comment 内部触发 `onReviewerAction` finalizer → 聚合投票 →
 *   按 worldConfig.prAutoMerge 决定 auto / manual 合入。
 */
import type { OocClass, OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type {
  ObjectConstructor,
  ConstructorContext,
  ReadableModule,
  ReadableContext,
  ReadonlySelfProxy,
  ExecutableModule,
  ObjectMethod,
  ExecutableContext,
  PersistableModule,
} from "@ooc/core/types/index.js";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import { onReviewerAction } from "./approval-flow.js";
import type { Data, Comment } from "./types.js";

const construct: ObjectConstructor<Data> = {
  description: "Open a PR review window (created by runtime when a feat-branch PR is filed).",
  schema: {
    prId: { type: "string", required: true, description: "PR id" },
    branch: { type: "string", required: true, description: "feat-branch name" },
    intent: { type: "string", required: true, description: "PR intent / description" },
    diff: { type: "string", required: false, description: "patch 文本" },
  },
  exec: (_ctx: ConstructorContext, args: { prId?: string; branch?: string; intent?: string; diff?: string }): Data => ({
    prId: args.prId ?? "",
    branch: args.branch ?? "",
    intent: args.intent ?? "",
    diff: args.diff ?? "",
    comments: [],
    status: "open",
    createdAt: Date.now(),
  }),
};

const commentMethod: ObjectMethod<Data> = {
  name: "comment",
  description: "Add a review comment to this PR.",
  schema: {
    body: { type: "string", required: true, description: "comment 正文" },
  },
  exec: async (ctx: ExecutableContext, self, args: { body?: string }) => {
    const comment: Comment = {
      authorObjectId: ctx.object.id,
      body: args.body ?? "",
      at: Date.now(),
    };
    self.data.comments.push(comment);
    // 触发 finalizer：comment 不算决议，但落账 reviews 流水（issue D 落地裁决 10）
    try {
      await onReviewerAction(ctx.worldDir, self.data.prId, ctx.object.id, "comment", args.body);
    } catch (e) {
      // PR-Issue 落账失败（可能 PR-Issue 已不存在）— 不阻断 method
      console.warn(`[pr.comment] onReviewerAction failed: ${(e as Error).message}`);
    }
    return { message: "[pr] comment added" };
  },
};

const approveMethod: ObjectMethod<Data> = {
  name: "approve",
  description: "Approve this PR.",
  schema: {},
  exec: async (ctx: ExecutableContext, self) => {
    self.data.status = "approved";
    try {
      await onReviewerAction(ctx.worldDir, self.data.prId, ctx.object.id, "approve");
    } catch (e) {
      console.warn(`[pr.approve] onReviewerAction failed: ${(e as Error).message}`);
    }
    return { message: "[pr] approved" };
  },
};

const rejectMethod: ObjectMethod<Data> = {
  name: "reject",
  description: "Reject this PR.",
  schema: {
    reason: { type: "string", required: false, description: "拒绝原因" },
  },
  exec: async (ctx: ExecutableContext, self, args: { reason?: string }) => {
    self.data.status = "rejected";
    if (args.reason) {
      self.data.comments.push({
        authorObjectId: ctx.object.id,
        body: `[reject] ${args.reason}`,
        at: Date.now(),
      });
    }
    try {
      await onReviewerAction(ctx.worldDir, self.data.prId, ctx.object.id, "reject", args.reason);
    } catch (e) {
      console.warn(`[pr.reject] onReviewerAction failed: ${(e as Error).message}`);
    }
    return { message: "[pr] rejected" };
  },
};

const executable: ExecutableModule<Data> = {
  methods: [commentMethod, approveMethod, rejectMethod],
};

const readable: ReadableModule<Data, unknown> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, _win: OocObjectRef<unknown>) => ({
    class: "pr",
    content: [
      xmlElement("pr", { id: self.data.prId, branch: self.data.branch, status: self.data.status }, [
        xmlElement("intent", {}, [xmlText(self.data.intent)]),
        xmlElement("diff", {}, [xmlText(self.data.diff.slice(0, 8192))]),
        xmlElement("comments", { count: String(self.data.comments.length) }, [
          ...self.data.comments.map((c) =>
            xmlElement(
              "comment",
              { author: c.authorObjectId, at: String(c.at) },
              [xmlText(c.body)],
            ),
          ),
        ]),
      ]),
    ],
  }),
  window: [
    {
      class: "pr",
      object_methods: ["comment", "approve", "reject"],
      window_methods: [],
    },
  ],
};

/**
 * inline persistable：PR window data 随载体 thread 落盘——不写独立 data.json。
 *
 * 持久化底座（不可丢失）= PR-Issue `stones/.stones_repo/.pr-issues/<id>.json`，
 * 由 `core/persistable/pr-issue.ts` 维护。PR window 是 PR-Issue 的 view，inline 模式
 * 即可——丢了 reviewer 重 hydrate 时按 prId 重新拉。
 */
const persistable: PersistableModule<Data> = {
  // inline 模式：留空 save/load；core 会跳过、由父对象（thread）整体落盘。
};

export const Class: OocClass<Data> = {
  id: "_builtin/agent/pr",
  construct,
  executable,
  readable,
  persistable,
};

export type { Data, Comment } from "./types.js";
