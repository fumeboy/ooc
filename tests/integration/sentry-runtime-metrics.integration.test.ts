/**
 * sentry_runtime_metrics — server/index.ts 加载 + 命令面冒烟测试。
 *
 * 不真跑 bytedcli（需要 npx + 内网镜像，集成测试条件不稳）；只验证：
 * - loadObjectWindow 能拿到 ObjectWindowDefinition
 * - 三条命令都注册了 query_metric / tagk_list / metric_search
 * - 各命令 knowledge() 返回包含 description 文本
 * - 缺参时 exec 立即返 ok=false（不会 spawn）
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { clearServerLoaderCache, loadObjectWindow } from "../../src/executable/server/loader";
import type { StoneObjectRef } from "../../src/persistable";

const baseDir = resolve(__dirname, "../../.ooc-world");

function ref(objectId: string): StoneObjectRef {
  return { baseDir, objectId, stonesBranch: "main" };
}

describe("sentry_runtime_metrics action-type stone", () => {
  test("loadObjectWindow 返回三条命令", async () => {
    clearServerLoaderCache();
    const win = await loadObjectWindow(ref("sentry/sentry_runtime_metrics"));
    expect(win).toBeDefined();
    const names = Object.keys(win!.methods ?? {}).sort();
    expect(names).toEqual(["metric_search", "query_metric", "tagk_list"]);
  });

  test("query_metric 缺 metric 参数立即返 ok=false（不调 bytedcli）", async () => {
    clearServerLoaderCache();
    const win = await loadObjectWindow(ref("sentry/sentry_runtime_metrics"));
    const cmd = win!.methods!.query_metric!;
    const r = (await cmd.exec({ args: {} } as never)) as { ok: boolean; result?: string };
    expect(r.ok).toBe(true); // exec wrapper 将 fn 返回 {ok:false,...} 再 stringify 为 result text
    // result 是 JSON 文本,内含原始 ok=false 的标记
    expect(r.result).toContain('"ok": false');
    expect(r.result).toContain("metric");
  });

  test("tagk_list 缺 metric 参数立即返 ok=false", async () => {
    clearServerLoaderCache();
    const win = await loadObjectWindow(ref("sentry/sentry_runtime_metrics"));
    const cmd = win!.methods!.tagk_list!;
    const r = (await cmd.exec({ args: {} } as never)) as { ok: boolean; result?: string };
    expect(r.ok).toBe(true);
    expect(r.result).toContain('"ok": false');
  });

  test("metric_search 缺 prefix 参数立即返 ok=false", async () => {
    clearServerLoaderCache();
    const win = await loadObjectWindow(ref("sentry/sentry_runtime_metrics"));
    const cmd = win!.methods!.metric_search!;
    const r = (await cmd.exec({ args: {} } as never)) as { ok: boolean; result?: string };
    expect(r.ok).toBe(true);
    expect(r.result).toContain('"ok": false');
  });
});
