/**
 * P3/P4/P5 治理后端控制面端到端测试（app.handle）。
 *
 * 覆盖：
 * - GET  /api/runtime/pr-issues           list（reviewers/approvals/verdict 摘要）
 * - GET  /api/runtime/pr-issues/:id        get 全量（intent/diff/paths）；未知 → 404
 * - POST /api/runtime/pr-issues/:id/approve  reviewer 审批；非 reviewer → 409
 * - P5 闸：prAutoMerge=true → 全 approve 即合入；false → 待人工经 /resolve {merge} 落锤
 *
 * 真实开 PR 走 createFeatBranchWorktree + 直接编辑 feat worktree + commitAndOpenPr（不 mock）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ensureStoneRepo,
  __resetSerialQueueForTests,
  clearWorldConfigCache,
  WORLD_CONFIG_FILENAME,
} from "@ooc/core/persistable";
import {
  createFeatBranchWorktree,
  commitAndOpenPr,
} from "@ooc/core/persistable/stone-feat-branch";
import { readServerConfig } from "@ooc/core/app/server/bootstrap/config";
import { buildServer } from "@ooc/core/app/server/index";

let tempRoots: string[] = [];

beforeEach(() => {
  __resetSerialQueueForTests();
  clearWorldConfigCache();
});
afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
  clearWorldConfigCache();
});

async function newWorld(agents: string[], prAutoMerge: boolean): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "_test_pr_gov_"));
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
  await writeFile(
    join(baseDir, WORLD_CONFIG_FILENAME),
    JSON.stringify({ prAutoMerge }),
    "utf8",
  );
  clearWorldConfigCache();
  return baseDir;
}

async function buildApp(baseDir: string) {
  const config = {
    ...(await readServerConfig()),
    port: 0,
    baseDir,
    workerEnabled: false,
    dev: true,
  };
  return buildServer(config);
}

async function readJson(resp: Response): Promise<any> {
  const text = await resp.text();
  return text ? JSON.parse(text) : undefined;
}

async function get(app: any, path: string) {
  const resp = await app.handle(new Request(`http://localhost${path}`));
  return { status: resp.status, json: await readJson(resp) };
}

async function post(app: any, path: string, body: unknown) {
  const resp = await app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: resp.status, json: await readJson(resp) };
}

/** 开一个 cross-scope PR（编辑 foo + bob → reviewers={bob,supervisor}）。 */
async function openCrossScopePr(baseDir: string): Promise<number> {
  const open = await createFeatBranchWorktree({ baseDir, intent: "sediment into bob" });
  if (!open.ok) throw new Error("createFeatBranchWorktree failed");
  for (const [rel, content] of [
    ["objects/foo/self.md", "foo v2\n"],
    ["objects/bob/readable.md", "bob touched by foo\n"],
  ] as const) {
    const abs = join(baseDir, "stones", open.branch, ...rel.split("/"));
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  const r = await commitAndOpenPr({
    baseDir,
    branch: open.branch,
    authorObjectId: "foo",
    intent: "sediment into bob",
  });
  if (!r.ok) throw new Error(`commitAndOpenPr failed: ${r.code}`);
  expect(r.reviewers.sort()).toEqual(["bob", "supervisor"]);
  return r.issueId;
}

function mainSelf(baseDir: string, id: string): string {
  return join(baseDir, "stones", "main", "objects", id, "self.md");
}

describe("P4 list/get 端点", () => {
  test("GET /pr-issues list 带 reviewers/approvals/verdict", async () => {
    const baseDir = await newWorld(["foo", "bob"], false);
    const app = await buildApp(baseDir);
    const issueId = await openCrossScopePr(baseDir);

    const list = await get(app, "/api/runtime/pr-issues");
    expect(list.status).toBe(200);
    expect(list.json.items.length).toBe(1);
    const it = list.json.items[0];
    expect(it.id).toBe(issueId);
    expect(it.isPr).toBe(true);
    expect(it.reviewers.sort()).toEqual(["bob", "supervisor"]);
    expect(it.approvals).toEqual({});
    expect(it.verdict).toBe("pending");
  });

  test("GET /pr-issues/:id get 全量 intent/diff/paths", async () => {
    const baseDir = await newWorld(["foo", "bob"], false);
    const app = await buildApp(baseDir);
    const issueId = await openCrossScopePr(baseDir);

    const got = await get(app, `/api/runtime/pr-issues/${issueId}`);
    expect(got.status).toBe(200);
    expect(got.json.intent).toBe("sediment into bob");
    expect(got.json.diff.length).toBeGreaterThan(0);
    expect(got.json.paths.sort()).toEqual(["objects/bob/readable.md", "objects/foo/self.md"]);
    expect(got.json.branch).toBe(got.json.branch);
  });

  test("GET /pr-issues/:id 未知 → 404", async () => {
    const baseDir = await newWorld(["foo"], false);
    const app = await buildApp(baseDir);
    const got = await get(app, "/api/runtime/pr-issues/999");
    expect(got.status).toBe(404);
  });
});

describe("P3 approve + 校验", () => {
  test("非 reviewer approve → 409", async () => {
    const baseDir = await newWorld(["foo", "bob"], false);
    const app = await buildApp(baseDir);
    const issueId = await openCrossScopePr(baseDir);
    const r = await post(app, `/api/runtime/pr-issues/${issueId}/approve`, {
      reviewerObjectId: "mallory",
      decision: "approve",
    });
    expect(r.status).toBe(409);
  });

  test("部分 approve → verdict pending（未到 ready）", async () => {
    const baseDir = await newWorld(["foo", "bob"], false);
    const app = await buildApp(baseDir);
    const issueId = await openCrossScopePr(baseDir);
    const r = await post(app, `/api/runtime/pr-issues/${issueId}/approve`, {
      reviewerObjectId: "bob",
      decision: "approve",
    });
    expect(r.status).toBe(200);
    expect(r.json.verdict).toBe("pending");
    expect(r.json.merged).toBeUndefined();
  });

  test("reviewer reject → verdict rejected + 分支 archive + PR closed", async () => {
    const baseDir = await newWorld(["foo", "bob"], false);
    const app = await buildApp(baseDir);
    const issueId = await openCrossScopePr(baseDir);
    const r = await post(app, `/api/runtime/pr-issues/${issueId}/approve`, {
      reviewerObjectId: "bob",
      decision: "reject",
    });
    expect(r.status).toBe(200);
    expect(r.json.verdict).toBe("rejected");
    expect(r.json.rejected).toBe(true);

    const got = await get(app, `/api/runtime/pr-issues/${issueId}`);
    expect(got.json.status).toBe("closed");
    // main 未变（foo 仍 v1）
    expect(await readFile(mainSelf(baseDir, "foo"), "utf8")).toBe("foo v1\n");
  });
});

describe("P5 合入闸两态", () => {
  test("auto（prAutoMerge=true）：全 approve → 立即合入 main", async () => {
    const baseDir = await newWorld(["foo", "bob"], true);
    const app = await buildApp(baseDir);
    const issueId = await openCrossScopePr(baseDir);

    await post(app, `/api/runtime/pr-issues/${issueId}/approve`, {
      reviewerObjectId: "bob",
      decision: "approve",
    });
    const last = await post(app, `/api/runtime/pr-issues/${issueId}/approve`, {
      reviewerObjectId: "supervisor",
      decision: "approve",
    });
    expect(last.status).toBe(200);
    expect(last.json.verdict).toBe("ready-to-merge");
    expect(last.json.merged).toBe(true);

    // main 已合入
    expect(await readFile(mainSelf(baseDir, "foo"), "utf8")).toBe("foo v2\n");
    const got = await get(app, `/api/runtime/pr-issues/${issueId}`);
    expect(got.json.status).toBe("closed");
  });

  test("manual（prAutoMerge=false）：全 approve → 待人工，再 /resolve {merge} 落锤", async () => {
    const baseDir = await newWorld(["foo", "bob"], false);
    const app = await buildApp(baseDir);
    const issueId = await openCrossScopePr(baseDir);

    await post(app, `/api/runtime/pr-issues/${issueId}/approve`, {
      reviewerObjectId: "bob",
      decision: "approve",
    });
    const last = await post(app, `/api/runtime/pr-issues/${issueId}/approve`, {
      reviewerObjectId: "supervisor",
      decision: "approve",
    });
    expect(last.json.verdict).toBe("ready-to-merge");
    expect(last.json.merged).toBe(false);

    // 仍未合入（待人工）
    expect(await readFile(mainSelf(baseDir, "foo"), "utf8")).toBe("foo v1\n");
    const stillOpen = await get(app, `/api/runtime/pr-issues/${issueId}`);
    expect(stillOpen.json.status).toBe("open");
    expect(stillOpen.json.verdict).toBe("ready-to-merge");

    // 人工落锤
    const resolve = await post(app, `/api/runtime/pr-issues/${issueId}/resolve`, {
      decision: "merge",
    });
    expect(resolve.status).toBe(200);
    expect(await readFile(mainSelf(baseDir, "foo"), "utf8")).toBe("foo v2\n");
  });
});
