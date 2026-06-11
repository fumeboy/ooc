/**
 * Frontend e2e — routing + FileTree 接 ObjectClientRenderer。
 *
 * 覆盖判据：
 * - FR1: 直接打 /stones/<id> URL → 渲染 stone client
 * - FR2: 主页 → 在 stones tree 点 client/index.tsx → URL 变 /stones/<id> + 渲染
 * - FR3: tab 切 "源码" → CodeMirror；再切 "已渲染" 保留 button click 计数
 * - FR4: 浏览器后退键 → URL + UI 同步回
 * - FR5: 未知 URL `/stones/no-such` → 仍渲染 ClientWithSourceToggle 但 client 显示
 *        "信息待产出..."（文件不存在），证明路由不报错
 */

import { collectConsoleErrors, expect, test } from "./_fixture-client";

const PING_SERVER = `export const window = { methods: {
  ping: {
    description: "echoes",
    for_ui_access: true,
    exec: async ({ args }) => ({ ok: true, data: { pong: args.value ?? "default" } }),
  },
} };`;

const PING_CLIENT = `import { useState } from "react";
export default function View({ callMethod }) {
  const [count, setCount] = useState(0);
  const [result, setResult] = useState(null);
  return (
    <div>
      <button data-testid="count-btn" onClick={() => setCount((c) => c + 1)}>count {count}</button>
      <button data-testid="ping-btn" onClick={async () => {
        const r = await callMethod("ping", { value: "hi" });
        setResult(JSON.stringify(r));
      }}>ping</button>
      <div data-testid="result">{result}</div>
    </div>
  );
}`;

test.describe("Web routing + FileTree client integration", () => {
  test("FR1 直接打 /stones/<id> URL → 渲染 stone client", async ({ page, world }) => {
    world.createStone("alpha");
    world.writeStoneServer("alpha", PING_SERVER);
    world.writeStoneClient("alpha", PING_CLIENT);
    await world.startStack();
    const consoleLog = collectConsoleErrors(page);

    await page.goto(`${getWebUrl(world)}/stones/alpha`);
    await expect(page.getByTestId("ping-btn")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("client-toggle-tabs")).toBeVisible();

    // callMethod 仍工作
    await page.getByTestId("ping-btn").click();
    await expect(page.getByTestId("result")).toHaveText('{"pong":"hi"}', { timeout: 10_000 });

    expect(consoleLog.errors).toEqual([]);
  });

  test("FR2 主页 → click stones tree 项 → URL 变化 + 渲染", async ({ page, world }) => {
    world.createStone("beta");
    world.writeStoneClient(
      "beta",
      `export default function V() { return <div data-testid="beta-content">hello-beta</div>; }`,
    );
    await world.startStack();

    await page.goto(getWebUrl(world));
    // 切到 stones tab → URL 应变 /stones（sidebar tabs 用 <a href>，
    // 浏览器右键/中键能用；getByRole("link") 而非 "button"）。
    await page.getByRole("link", { name: "Stones", exact: true }).click();
    await expect(page).toHaveURL(/\/stones$/, { timeout: 10_000 });

    // stones repo tree 结构：
    // stones → <branch>=main → objects → <objectId> → client → index.tsx
    await expect(page.locator(".tree-button").filter({ hasText: "main" })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator(".tree-button").filter({ hasText: "main" }).first().click();

    await expect(page.locator(".tree-button").filter({ hasText: "objects" })).toBeVisible({
      timeout: 10_000,
    });
    await page.locator(".tree-button").filter({ hasText: "objects" }).first().click();

    await expect(page.locator(".tree-button").filter({ hasText: "beta" })).toBeVisible({
      timeout: 15_000,
    });

    // 展开 beta，再展开 client，再点 index.tsx
    await page.locator(".tree-button").filter({ hasText: "beta" }).first().click();
    await expect(page.locator(".tree-button").filter({ hasText: "client" })).toBeVisible({
      timeout: 5_000,
    });
    await page.locator(".tree-button").filter({ hasText: "client" }).first().click();
    await expect(page.locator(".tree-button").filter({ hasText: "index.tsx" })).toBeVisible({
      timeout: 5_000,
    });
    await page.locator(".tree-button").filter({ hasText: "index.tsx" }).first().click();

    await expect(page).toHaveURL(/\/stones\/beta$/, { timeout: 10_000 });
    await expect(page.getByTestId("beta-content")).toHaveText("hello-beta", { timeout: 10_000 });
  });

  test("FR3 tab 切源码后切回，保留组件 state", async ({ page, world }) => {
    world.createStone("gamma");
    world.writeStoneClient("gamma", PING_CLIENT);
    await world.startStack();

    await page.goto(`${getWebUrl(world)}/stones/gamma`);
    await expect(page.getByTestId("count-btn")).toBeVisible({ timeout: 15_000 });

    // 点 3 次
    for (let i = 0; i < 3; i++) await page.getByTestId("count-btn").click();
    await expect(page.getByTestId("count-btn")).toHaveText("count 3");

    // 切到源码
    await page.getByTestId("tab-source").click();
    await expect(page.getByTestId("source-pane")).toBeVisible();
    // 源码面板内出现 fetched tsx 内容（不依赖 CodeMirror 具体选择器）
    await expect(page.getByTestId("source-pane")).toContainText("export default", {
      timeout: 10_000,
    });

    // render 面板被隐藏（display:none），但仍在 DOM 中
    const renderPane = page.getByTestId("render-pane");
    await expect(renderPane).toBeAttached();
    await expect(renderPane).not.toBeVisible();

    // 切回 render
    await page.getByTestId("tab-render").click();
    // count 仍是 3（组件 state 没丢）
    await expect(page.getByTestId("count-btn")).toHaveText("count 3");
  });

  test("FR4 浏览器后退键 → URL + UI 同步回", async ({ page, world }) => {
    world.createStone("delta");
    world.createStone("epsilon");
    world.writeStoneClient("delta", `export default function D() { return <div data-testid="delta">delta-ui</div>; }`);
    world.writeStoneClient("epsilon", `export default function E() { return <div data-testid="epsilon">epsilon-ui</div>; }`);
    await world.startStack();

    await page.goto(`${getWebUrl(world)}/stones/delta`);
    await expect(page.getByTestId("delta")).toBeVisible({ timeout: 15_000 });

    await page.goto(`${getWebUrl(world)}/stones/epsilon`);
    await expect(page.getByTestId("epsilon")).toBeVisible({ timeout: 15_000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/stones\/delta$/);
    await expect(page.getByTestId("delta")).toBeVisible({ timeout: 10_000 });

    await page.goForward();
    await expect(page).toHaveURL(/\/stones\/epsilon$/);
    await expect(page.getByTestId("epsilon")).toBeVisible({ timeout: 10_000 });
  });

  test("FR5 /stones/<不存在> → StoneFallback 显示 \"Stone not found\"", async ({ page, world }) => {
    await world.startStack();
    // 没创建任何 stone
    await page.goto(`${getWebUrl(world)}/stones/nonexistent`);
    // ClientWithSourceToggle 已挂上；StoneFallback 在 stone 不存在时
    // 渲染 StoneNotFoundCard 而非旧的 "信息待产出..."。
    await expect(page.getByTestId("stone-not-found")).toBeVisible({ timeout: 15_000 });
    // 路由本身不应报 errorElement
    await expect(page.getByTestId("route-error")).toHaveCount(0);
  });
});

// fixture 把 web URL 藏在 previewUrl 里；这里临时复刻一份（fixture 没暴露 .web.url）
function getWebUrl(world: { previewUrl: (q: { scope: "stone"; objectId: string }) => string }): string {
  const url = world.previewUrl({ scope: "stone", objectId: "_probe_" });
  const idx = url.indexOf("/object-client.html");
  return url.slice(0, idx);
}
