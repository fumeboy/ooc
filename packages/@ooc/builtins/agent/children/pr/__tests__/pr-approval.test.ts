/**
 * 多 reviewer 审批聚合 —— aggregatePrApproval 纯逻辑 + approvePrIssue 写入/校验。
 *
 * 验证：
 * - aggregatePrApproval：全 approve → ready-to-merge；任一 reject → rejected（一票否决）；
 *   有 changes-requested 无 reject → changes-requested；缺批 → pending；空 reviewers → pending。
 * - approvePrIssue：写 approvals[reviewer]、返回聚合 verdict；非 reviewer 拒 NOT_A_REVIEWER；
 *   未知 issue → NOT_FOUND；已 closed → INVALID_STATE。
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetSerialQueueForTests } from "@ooc/core/runtime/serial-queue";
import {
  aggregatePrApproval,
  approvePrIssue,
  closePrIssue,
  createPrIssue,
  readPrIssue,
} from "../persistable/pr-issue";

let tempRoot: string | undefined;

beforeEach(() => __resetSerialQueueForTests());
afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function newWorld(authors: string[]): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "_test_pr_approval_"));
  for (const id of authors) {
    await mkdir(join(tempRoot, "stones", "main", "objects", id), { recursive: true });
  }
  return tempRoot;
}

const payload = (branch: string) => ({
  intent: "sediment foo knowledge",
  branch,
  diff: "diff --git a/objects/foo/self.md ...",
  paths: ["objects/foo/self.md"],
  baseSha: "0123456789abcdef",
});

describe("aggregatePrApproval (纯逻辑)", () => {
  test("全 approve → ready-to-merge", () => {
    expect(
      aggregatePrApproval(["bob", "supervisor"], { bob: "approved", supervisor: "approved" }),
    ).toBe("ready-to-merge");
  });

  test("任一 reject → rejected（一票否决，盖过 changes-requested）", () => {
    expect(
      aggregatePrApproval(["bob", "supervisor"], { bob: "rejected", supervisor: "approved" }),
    ).toBe("rejected");
    expect(
      aggregatePrApproval(["bob", "supervisor"], {
        bob: "rejected",
        supervisor: "changes-requested",
      }),
    ).toBe("rejected");
  });

  test("有 changes-requested 无 reject → changes-requested", () => {
    expect(
      aggregatePrApproval(["bob", "supervisor"], {
        bob: "changes-requested",
        supervisor: "approved",
      }),
    ).toBe("changes-requested");
  });

  test("仍有 reviewer 未批 → pending", () => {
    expect(aggregatePrApproval(["bob", "supervisor"], { supervisor: "approved" })).toBe("pending");
    expect(aggregatePrApproval(["bob", "supervisor"], {})).toBe("pending");
    expect(aggregatePrApproval(["bob", "supervisor"], undefined)).toBe("pending");
  });

  test("空 reviewers → pending（fail-safe 不自动放行）", () => {
    expect(aggregatePrApproval([], { x: "approved" })).toBe("pending");
    expect(aggregatePrApproval(undefined, undefined)).toBe("pending");
  });

  test("approvals 越界 key 不影响判定（防御）", () => {
    expect(
      aggregatePrApproval(["supervisor"], { supervisor: "approved", ghost: "rejected" }),
    ).toBe("ready-to-merge");
  });
});

describe("approvePrIssue (写入 + 校验)", () => {
  async function openPr(baseDir: string, reviewers: string[]) {
    return createPrIssue({
      baseDir,
      title: "sediment",
      createdByObjectId: "foo",
      reviewers,
      prPayload: payload("feat/sediment"),
    });
  }

  test("reviewer approve → 写 approvals + verdict 推进", async () => {
    const baseDir = await newWorld(["foo", "bob"]);
    const issue = await openPr(baseDir, ["bob", "supervisor"]);

    const r1 = await approvePrIssue({
      baseDir,
      issueId: issue.id,
      reviewerObjectId: "bob",
      action: "approve",
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.verdict).toBe("pending"); // supervisor 还没批
    expect(r1.issue.approvals).toEqual({ bob: "approved" });

    const r2 = await approvePrIssue({
      baseDir,
      issueId: issue.id,
      reviewerObjectId: "supervisor",
      action: "approve",
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.verdict).toBe("ready-to-merge");

    const onDisk = await readPrIssue(baseDir, issue.id);
    expect(onDisk?.approvals).toEqual({ bob: "approved", supervisor: "approved" });
  });

  test("任一 reject → verdict rejected", async () => {
    const baseDir = await newWorld(["foo", "bob"]);
    const issue = await openPr(baseDir, ["bob", "supervisor"]);
    const r = await approvePrIssue({
      baseDir,
      issueId: issue.id,
      reviewerObjectId: "bob",
      action: "reject",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verdict).toBe("rejected");
  });

  test("request-changes → verdict changes-requested", async () => {
    const baseDir = await newWorld(["foo", "bob"]);
    const issue = await openPr(baseDir, ["bob", "supervisor"]);
    await approvePrIssue({
      baseDir,
      issueId: issue.id,
      reviewerObjectId: "supervisor",
      action: "approve",
    });
    const r = await approvePrIssue({
      baseDir,
      issueId: issue.id,
      reviewerObjectId: "bob",
      action: "request-changes",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verdict).toBe("changes-requested");
  });

  test("非 reviewer → NOT_A_REVIEWER", async () => {
    const baseDir = await newWorld(["foo", "bob"]);
    const issue = await openPr(baseDir, ["bob", "supervisor"]);
    const r = await approvePrIssue({
      baseDir,
      issueId: issue.id,
      reviewerObjectId: "mallory",
      action: "approve",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_A_REVIEWER");
  });

  test("未知 issue → NOT_FOUND", async () => {
    const baseDir = await newWorld(["foo"]);
    const r = await approvePrIssue({
      baseDir,
      issueId: 999,
      reviewerObjectId: "supervisor",
      action: "approve",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  test("已 closed → INVALID_STATE", async () => {
    const baseDir = await newWorld(["foo"]);
    const issue = await openPr(baseDir, ["supervisor"]);
    await closePrIssue({ baseDir, issueId: issue.id });
    const r = await approvePrIssue({
      baseDir,
      issueId: issue.id,
      reviewerObjectId: "supervisor",
      action: "approve",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_STATE");
  });
});
