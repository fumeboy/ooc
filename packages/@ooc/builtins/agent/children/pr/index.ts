/**
 * pr —— ooc class。reviewer 收到的 PR 评审窗。
 *
 * 流程：super(foo) 创建 feat-branch + 落 PR → runtime 实例化 pr object 投递给 reviewer →
 * reviewer agent 经 comment / approve / reject method 操作。
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
} from "@ooc/core/types/index.js";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import { type Data, type Comment, VERSIONED_FIELDS } from "./types.js";

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
  exec: (ctx: ExecutableContext, self, args: { body?: string }) => {
    const comment: Comment = {
      authorObjectId: ctx.object.id,
      body: args.body ?? "",
      at: Date.now(),
    };
    self.data.comments.push(comment);
    return { message: "[pr] comment added" };
  },
};

const approveMethod: ObjectMethod<Data> = {
  name: "approve",
  description: "Approve this PR.",
  schema: {},
  exec: (_ctx: ExecutableContext, self) => {
    self.data.status = "approved";
    return { message: "[pr] approved" };
  },
};

const rejectMethod: ObjectMethod<Data> = {
  name: "reject",
  description: "Reject this PR.",
  schema: {
    reason: { type: "string", required: false, description: "拒绝原因" },
  },
  exec: (ctx: ExecutableContext, self, args: { reason?: string }) => {
    self.data.status = "rejected";
    if (args.reason) {
      self.data.comments.push({
        authorObjectId: ctx.object.id,
        body: `[reject] ${args.reason}`,
        at: Date.now(),
      });
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

export const Class: OocClass<Data> = {
  id: "_builtin/agent/pr",
  construct,
  executable,
  readable,
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data, Comment } from "./types.js";
