/**
 * Frontend e2e — A2：flow object 经 callMethod 调 visible/server 改 data（确定性，绕 thread/LLM）。
 *
 * 验证「class 自写 visible UI（flow client page）经 flow callMethod 调 visible/server 改 data」端到端：
 *   前端按钮 → callMethod("set_content"/"toggle_done") → POST /api/flows/:sid/:oid/call_method
 *   → backend 沿 .flow.json:class（_builtin/agent/todo）继承链 dispatch visibleServer → 改 data
 *   → 落 data.json（裸 data）。前端显示更新 + HTTP 直读 data.json 双向核验。
 *
 * stone-scope 原则下 stone client 只读（callMethod undefined，见 object-client-renderer FC2）；
 * 运行时/data 编辑只在 flow scope —— 本 spec 即 flow scope callMethod 的端到端覆盖。
 *
 * 无 LLM：flow object 直建（.session.json + .flow.json:class），不走 thinkloop/chat。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectConsoleErrors, expect, test } from "./_fixture-client";

const SID = "a2flow";
const OID = "todo_a2";
const PAGE = "edit";

/** 读 flows/<sid>/objects/<oid>/data.json（visibleServer reportDataEdit 系统默认落点）。 */
function readDataJson(baseDir: string, sid: string, oid: string): { content?: string; status?: string } | undefined {
  // objectId 无嵌套时 nested path === [oid]；与 fixture writeFlowClientPage / objectDir 一致。
  const p = join(baseDir, "flows", sid, "objects", oid, "data.json");
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
}

test.describe("Flow visible/server edit e2e (A2)", () => {
  test("A2 flow client → callMethod set_content/toggle_done → 改 data + 落 data.json", async ({ page, world }) => {
    // flow object 继承 builtin todo（其 visibleServer 提供 set_content / toggle_done）。
    world.createFlowObject(SID, OID, "_builtin/agent/todo");
    // 写一个最简 flow client page：拿 renderer 注入的 callMethod 调 visible/server，回显结果。
    world.writeFlowClientPage({
      sessionId: SID,
      objectId: OID,
      page: PAGE,
      code: `import { useState } from "react";
export default function Edit({ callMethod, sessionId, objectName }) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  return (
    <div>
      <span data-testid="sid">{sessionId}</span>
      <span data-testid="oid">{objectName}</span>
      <input
        data-testid="content-input"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <button
        data-testid="save-btn"
        onClick={async () => {
          const r = await callMethod("set_content", { content });
          setContent((r && r.content) || "");
        }}
      >保存正文</button>
      <button
        data-testid="toggle-btn"
        onClick={async () => {
          const r = await callMethod("toggle_done", {});
          setStatus((r && r.status) || "");
        }}
      >切完成</button>
      <div data-testid="content-out">{content}</div>
      <div data-testid="status-out">{status}</div>
    </div>
  );
}`,
    });

    await world.startStack();
    const consoleLog = collectConsoleErrors(page);

    await page.goto(
      world.previewUrl({ scope: "flow", sessionId: SID, objectId: OID, page: PAGE }),
    );

    // renderer 把 sessionId / objectName 透传给 flow client
    await expect(page.getByTestId("sid")).toHaveText(SID, { timeout: 15_000 });
    await expect(page.getByTestId("oid")).toHaveText(OID);

    // set_content：输入正文 → callMethod → visibleServer 改 data → 回显 + 落 data.json
    await page.getByTestId("content-input").fill("买牛奶");
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("content-out")).toHaveText("买牛奶", { timeout: 10_000 });
    await expect
      .poll(() => readDataJson(world.baseDir, SID, OID)?.content, { timeout: 10_000 })
      .toBe("买牛奶");

    // toggle_done：翻转 status → done（跨调用基于刚落盘的 data）
    await page.getByTestId("toggle-btn").click();
    await expect(page.getByTestId("status-out")).toHaveText("done", { timeout: 10_000 });
    const data = readDataJson(world.baseDir, SID, OID);
    expect(data?.status).toBe("done");
    expect(data?.content).toBe("买牛奶");

    expect(consoleLog.errors).toEqual([]);
  });
});
