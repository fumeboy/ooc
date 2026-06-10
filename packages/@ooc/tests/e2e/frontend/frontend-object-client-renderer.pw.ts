/**
 * Frontend e2e — Object Client Renderer
 *
 * 覆盖 plan §7 完成判据 1-6（除 2/3/4 真 LLM 路径外）：
 * - FC1: 没写 client (stone scope) → StoneFallback 名片 (Identity / About / Entry points)
 * - FC2: 写了正常的 stone client → 渲染按钮，callMethod 命中 for_ui_access 方法 data 显示
 * - FC3: 写了会抛错的 client → 红色错误块带堆栈，且不发任何 talk 请求
 * - FC4: 写了语法错误的 client → 红色加载错误块 (stone scope 改为 StoneFallback + error 折叠)
 * - FC5: 写了 flow page → 渲染并能拿到 sessionId
 */

import { collectConsoleErrors, expect, test } from "./_fixture-client";

test.describe("Object Client Renderer e2e", () => {
  test("FC1 没写 client (stone) → StoneFallback 名片", async ({ page, world }) => {
    world.createStone("alan");
    await world.startStack();

    await page.goto(world.previewUrl({ scope: "stone", objectId: "alan" }));
    // StoneFallback 替代了旧的 "信息待产出..." 死区 — 用 Entry points 标题断言
    await expect(page.getByText("Entry points / 入口")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("entry-view-source")).toBeVisible();
    await expect(page.getByTestId("entry-start-thread")).toBeVisible();
  });

  test("FC2 正常 stone client + callMethod → ping/pong 回显", async ({ page, world }) => {
    world.createStone("pingpong");
    world.writeStoneServer(
      "pingpong",
      `export const window = { methods: {
        ping: {
          description: "echoes back",
          for_ui_access: true,
          exec: async ({ args }) => ({ ok: true, data: { pong: args.value ?? "default" } }),
        },
      } };`,
    );
    world.writeStoneClient(
      "pingpong",
      `import { useState } from "react";
export default function View({ callMethod }) {
  const [result, setResult] = useState(null);
  return (
    <div>
      <button
        data-testid="ping-btn"
        onClick={async () => {
          const r = await callMethod("ping", { value: "hi" });
          setResult(JSON.stringify(r));
        }}
      >ping</button>
      <div data-testid="result">{result}</div>
    </div>
  );
}`,
    );

    await world.startStack();
    const consoleLog = collectConsoleErrors(page);

    await page.goto(world.previewUrl({ scope: "stone", objectId: "pingpong" }));
    await expect(page.getByTestId("ping-btn")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("ping-btn").click();
    await expect(page.getByTestId("result")).toHaveText('{"pong":"hi"}', {
      timeout: 10_000,
    });

    // 不应触发 console 错误
    expect(consoleLog.errors).toEqual([]);
  });

  test("FC3 render-time throw → 红色错误块 + 不发 talk 请求", async ({ page, world }) => {
    world.createStone("crash");
    world.writeStoneClient(
      "crash",
      `export default function Boom() {
  throw new Error("intentional render error from test");
}`,
    );

    const talkRequests: string[] = [];
    await world.startStack();
    await page.route("**/api/**/continue**", (route) => {
      talkRequests.push(route.request().url());
      return route.continue();
    });
    await page.route("**/api/**/call_method**", (route) => {
      talkRequests.push(route.request().url());
      return route.continue();
    });

    await page.goto(world.previewUrl({ scope: "stone", objectId: "crash" }));
    await expect(page.getByText(/渲染失败/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/intentional render error/)).toBeVisible();

    // 关键断言：渲染层不耦合 transport
    expect(talkRequests).toEqual([]);
  });

  test("FC4 syntax error in tsx → 红色加载错误块", async ({ page, world }) => {
    world.createStone("broken");
    world.writeStoneClient(
      "broken",
      `export default function Bad() {
  return <div>{this is not valid jsx</div>;
}`,
    );
    await world.startStack();

    await page.goto(world.previewUrl({ scope: "stone", objectId: "broken" }));
    // 加载阶段错误（Vite 转译失败）也会被 LoadErrorBox 捕到
    await expect(page.getByText(/加载失败|渲染失败/)).toBeVisible({ timeout: 15_000 });
  });

  test("FC5 flow page → 渲染并能读 sessionId / objectName", async ({ page, world }) => {
    world.writeFlowClientPage({
      sessionId: "s1",
      objectId: "alan",
      page: "report",
      code: `export default function Report({ sessionId, objectName }) {
  return (
    <div>
      <span data-testid="sid">{sessionId}</span>
      <span data-testid="oid">{objectName}</span>
    </div>
  );
}`,
    });
    await world.startStack();

    await page.goto(
      world.previewUrl({
        scope: "flow",
        sessionId: "s1",
        objectId: "alan",
        page: "report",
      }),
    );
    await expect(page.getByTestId("sid")).toHaveText("s1", { timeout: 15_000 });
    await expect(page.getByTestId("oid")).toHaveText("alan");
  });
});
