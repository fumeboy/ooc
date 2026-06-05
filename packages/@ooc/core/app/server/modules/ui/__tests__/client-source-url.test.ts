import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo, stoneDir, visibleDir } from "@ooc/core/persistable";
import { readServerConfig } from "../../../bootstrap/config";
import { buildServer } from "../../../index";

/**
 * Visible 维度 #1 回归（harness 2026-06-05 sweep）：
 *
 * `GET /api/objects/stone/:id/client-source-url` 只解析 canonical `visible/index.tsx`
 * 或 legacy `client/index.tsx`。Agent 若把组件写成 stone 根具名文件（如 `Card.tsx`），
 * 控制面取不到源 → 404，页面渲染不出。本测试钉住该契约，并验证 agent-facing knowledge
 * 已被改写指向 canonical `visible/index.tsx`（见 thinkable/knowledge/basic-knowledge.ts）。
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

  test("stone-root named .tsx (e.g. Card.tsx) does NOT resolve → 404 (contract: write visible/index.tsx)", async () => {
    const { app, baseDir } = await makeApp();
    const objectId = "vis_named";
    const dir = stoneDir({ baseDir, objectId });
    await mkdir(dir, { recursive: true });
    // Agent 误把组件写成根具名文件——这是 harness 暴露的首产页 404 落点
    await writeFile(join(dir, "Card.tsx"), "export default () => null;\n");

    const res = await fetchSource(app, objectId);
    expect(res.status).toBe(404);
  });
});
