/**
 * Tier A（control-plane）共享 harness。
 *
 * 基座沿用 _verify.ts 的已验证方式：`ensureStoneRepo` + `buildServer` + `app.handle`
 * （进程内、不起端口）。这是 createStone 经 HTTP 走 worktree 版本化的正确前提——
 * backend e2e fixture 的 startApp({initStoneGit}) 用的是普通 git init，布局不同，故此处不复用其 server 启动，
 * 只复用其**观察/评分纯函数**（layout 无关，见 stories 各自 import）。
 *
 * 关键约束（_verify.ts 踩过的坑）：
 *  - 涉及 versioning 的写（self/readme/executable）**必经 HTTP API**（worktree commit）；
 *    直写磁盘未提交会和后续 worktree ff-merge 冲突。直写仅用于非 versioning 的热更（writeStoneFile）。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ensureStoneRepo, stoneDir as realStoneDir } from "@ooc/core/persistable";
import { readServerConfig } from "@ooc/core/app/server/bootstrap/config";
import { buildServer } from "@ooc/core/app/server/index";
import type { TcResult } from "./types";

export type CpServer = {
  app: ReturnType<typeof buildServer>;
  baseDir: string;
  cleanup: () => Promise<void>;
};

/**
 * 起一份隔离的进程内 OOC app（ensureStoneRepo 后 buildServer）。
 * workerEnabled 默认 false（control-plane 测 HTTP + loader，不需 thinkloop）。
 */
export async function mkServer(opts: { workerEnabled?: boolean; workerMaxTicks?: number } = {}): Promise<CpServer> {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-storybook-cp-"));
  await ensureStoneRepo({ baseDir });
  const config = {
    ...(await readServerConfig()),
    port: 0,
    baseDir,
    workerEnabled: opts.workerEnabled ?? false,
    workerMaxTicks: opts.workerMaxTicks ?? 15,
    dev: true,
  };
  const app = buildServer(config);
  return {
    app,
    baseDir,
    cleanup: async () => {
      try { await (app as any).onStop?.(); } catch { /* ignore */ }
      try { await (app.store as any)?.runtime?.dispose?.(); } catch { /* ignore */ }
      try { await rm(baseDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

async function readJson(resp: Response): Promise<any> {
  const text = await resp.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return { __raw: text }; }
}

export async function postJson(
  app: CpServer["app"],
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const headers = new Headers({ ...extraHeaders });
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) { headers.set("content-type", "application/json"); init.body = JSON.stringify(body); }
  const resp = await app.handle(new Request(`http://localhost${path}`, init));
  return { status: resp.status, json: await readJson(resp) };
}

export async function putJson(
  app: CpServer["app"],
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const resp = await app.handle(new Request(`http://localhost${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  }));
  return { status: resp.status, json: await readJson(resp) };
}

export async function getJson(app: CpServer["app"], path: string): Promise<{ status: number; json: any }> {
  const resp = await app.handle(new Request(`http://localhost${path}`));
  return { status: resp.status, json: await readJson(resp) };
}

/** 直写 stone 目录文件（versioning 布局 stones/main/objects/<id>/）。仅用于非 versioning 热更（如 executable 源码）。 */
export function writeStoneFile(baseDir: string, objectId: string, relPath: string, content: string): string {
  const full = join(realStoneDir({ baseDir, objectId }), relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

/** stones/main 里某路径的 git 提交 sha 列表（versioning 持久化核验）。 */
export function stoneCommits(baseDir: string, relPathInMain: string): string[] {
  const r = Bun.spawnSync(["git", "-C", join(baseDir, "stones", "main"), "log", "--format=%H", "--", relPathInMain],
    { stdout: "pipe", stderr: "pipe" });
  return new TextDecoder().decode(r.stdout).trim().split("\n").filter(Boolean);
}

/** 读 flows/<sid>/objects/<objectId>/threads/<tid>/thread.json（不存在返回 undefined）。 */
export function readThreadJson(baseDir: string, sid: string, objectId: string, threadId: string): any | undefined {
  const p = join(baseDir, "flows", sid, "objects", objectId, "threads", threadId, "thread.json");
  if (!existsSync(p)) return undefined;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; }
}

/**
 * 读 thread-context.json（§10 退役 thread.json.contextWindows 后，contextWindows 的唯一权威）。
 * 返回 `{ threadId, contextWindows }`；不存在/坏数据 → undefined。
 * builtin feature 窗（talk/do/todo）以完整 inline 落盘，可直接读到 type/target 等字段。
 */
export function readThreadContextJson(baseDir: string, sid: string, objectId: string, threadId: string): any | undefined {
  const p = join(baseDir, "flows", sid, "objects", objectId, "threads", threadId, "thread-context.json");
  if (!existsSync(p)) return undefined;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; }
}

/** 收集 TC 结果的小记录器。 */
export class StoryRecorder {
  readonly tcs: TcResult[] = [];
  record(r: TcResult): void {
    this.tcs.push(r);
    const mark = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⬜";
    // eslint-disable-next-line no-console
    console.log(`${mark} ${r.id}  ${r.name}${r.detail ? `\n     ${r.detail}` : ""}`);
  }
  /** 断言相等的便捷记录。 */
  eq(id: string, name: string, actual: unknown, expected: unknown): boolean {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    this.record({ id, name, status: ok ? "PASS" : "FAIL", detail: ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` });
    return ok;
  }
  ok(id: string, name: string, cond: boolean, detail?: string): boolean {
    this.record({ id, name, status: cond ? "PASS" : "FAIL", detail: cond ? undefined : detail });
    return cond;
  }
  skip(id: string, name: string, detail?: string): void {
    this.record({ id, name, status: "SKIP", detail });
  }
}
