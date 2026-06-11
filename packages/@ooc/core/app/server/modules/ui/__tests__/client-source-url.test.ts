import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo, ensureSessionWorktree, stoneDir, visibleDir } from "@ooc/core/persistable";
import { readServerConfig } from "../../../bootstrap/config";
import { buildServer } from "../../../index";

/**
 * Visible 维度回归：
 *
 * `GET /api/objects/stone/:id/client-source-url` 只解析 canonical `visible/index.tsx`
 * 或 legacy `client/index.tsx`。Agent 若把组件写成 stone 根具名文件（如 `Card.tsx`），
 * 控制面取不到源 → 404，页面渲染不出。本测试钉住该契约，并验证 agent-facing knowledge
 * 已被改写指向 canonical `visible/index.tsx`（见 builtins/root/knowledge/self-evolution.md）。
 */
async function makeApp() {
  const baseDir = mkdtempSync(join(tmpdir(), "ooc-client-source-url-"));
  await ensureStoneRepo({ baseDir });
  const app = buildServer({
    ...(await readServerConfig()),
    port: 0,
    baseDir,
    workerPollMs: 5,
    workerEnabled: false,
  });
  return { app, baseDir };
}

async function fetchSource(app: Awaited<ReturnType<typeof makeApp>>["app"], objectId: string) {
  return app.handle(
    new Request(`http://localhost/api/objects/stone/${objectId}/client-source-url`),
  );
}

describe("ui · client-source-url stone scope", () => {
  test("canonical visible/index.tsx resolves", async () => {
    const { app, baseDir } = await makeApp();
    const objectId = "vis_canonical";
    const dir = visibleDir({ baseDir, objectId });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.tsx"), "export default () => null;\n");

    const res = await fetchSource(app, objectId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.absPath).toBe(join(dir, "index.tsx"));
    expect(body.fsUrl).toContain("/visible/index.tsx");
  });

  test("legacy client/index.tsx still resolves as fallback", async () => {
    const { app, baseDir } = await makeApp();
    const objectId = "vis_legacy";
    const dir = join(stoneDir({ baseDir, objectId }), "client");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.tsx"), "export default () => null;\n");

    const res = await fetchSource(app, objectId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.absPath).toBe(join(dir, "index.tsx"));
  });

  test("worktree 模型：带 ?sessionId 时业务 session 预览读 worktree 的 visible/index.tsx", async () => {
    const { app, baseDir } = await makeApp();
    const objectId = "vis_wt";
    // main 上的 canonical visible（须 commit，worktree 从 main HEAD checkout）
    const mainVisDir = visibleDir({ baseDir, objectId, _stonesBranch: "main" });
    await mkdir(mainVisDir, { recursive: true });
    await writeFile(join(mainVisDir, "index.tsx"), "export default () => 'MAIN';\n");
    const mainDir = join(baseDir, "stones", "main");
    Bun.spawnSync(["git", "add", "-A"], { cwd: mainDir });
    Bun.spawnSync(
      ["git", "-c", "user.name=t", "-c", "user.email=t@ooc.local", "commit", "-m", "seed"],
      { cwd: mainDir },
    );
    // 业务 session s1 建 worktree 并改 visible 产物
    await ensureSessionWorktree(baseDir, "s1");
    const wtVisDir = visibleDir({ baseDir, objectId, _stonesBranch: "session-s1" });
    await mkdir(wtVisDir, { recursive: true });
    await writeFile(join(wtVisDir, "index.tsx"), "export default () => 'WORKTREE';\n");

    // 带 sessionId → worktree；不带 → main
    const wtRes = await app.handle(
      new Request(`http://localhost/api/objects/stone/${objectId}/client-source-url?sessionId=s1`),
    );
    expect(wtRes.status).toBe(200);
    expect((await wtRes.json()).absPath).toBe(join(wtVisDir, "index.tsx"));

    const mainRes = await fetchSource(app, objectId);
    expect(mainRes.status).toBe(200);
    expect((await mainRes.json()).absPath).toBe(join(mainVisDir, "index.tsx"));
  });

  test("stone-root named .tsx (e.g. Card.tsx) does NOT resolve → 404 (contract: write visible/index.tsx)", async () => {
    const { app, baseDir } = await makeApp();
    const objectId = "vis_named";
    const dir = stoneDir({ baseDir, objectId });
    await mkdir(dir, { recursive: true });
    // Agent 误把组件写成根具名文件——首产页 404 的落点
    await writeFile(join(dir, "Card.tsx"), "export default () => null;\n");

    const res = await fetchSource(app, objectId);
    expect(res.status).toBe(404);
  });

  test("?file=diff 命中 visible/diff.tsx 时返回 200 + 正确路径", async () => {
    const { app, baseDir } = await makeApp();
    const objectId = "vis_diff_present";
    const dir = visibleDir({ baseDir, objectId });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "diff.tsx"), "export default () => null;\n");

    const res = await app.handle(
      new Request(`http://localhost/api/objects/stone/${objectId}/client-source-url?file=diff`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.absPath).toBe(join(dir, "diff.tsx"));
    expect(body.fsUrl).toContain("/visible/diff.tsx");
  });

  test("?file=diff 且 visible/diff.tsx 缺失 → 404（无 legacy 回退）", async () => {
    const { app, baseDir } = await makeApp();
    const objectId = "vis_diff_absent";
    // 写 visible/index.tsx 和 legacy client/index.tsx，但不写 diff.tsx
    const visDir = visibleDir({ baseDir, objectId });
    await mkdir(visDir, { recursive: true });
    await writeFile(join(visDir, "index.tsx"), "export default () => null;\n");
    const legacyDir = join(stoneDir({ baseDir, objectId }), "client");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "index.tsx"), "export default () => null;\n");

    const res = await app.handle(
      new Request(`http://localhost/api/objects/stone/${objectId}/client-source-url?file=diff`),
    );
    // diff 无 legacy 对应物；必须干净 404，不应回退到 index.tsx
    expect(res.status).toBe(404);
  });
});
