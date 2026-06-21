/**
 * Frontend e2e — A1：通用文件编辑器（FileViewer 编辑态经 PUT /api/stones/:id/file）。
 *
 * 验证「在完整 shell 里打开一个 stone 源文件 → 编辑 → 保存 → 落盘（版本化 commit）」端到端：
 *   /files/stones/main/objects/<id>/self.md → 只读 markdown 预览 + 「编辑」入口
 *   → CodeMirror 改内容 → 「保存」 → PUT /api/stones/<id>/file body{path,content}
 *   → 覆盖护栏（已有内容）触发 window.confirm，确认后带 X-Overwrite-Confirm 重试
 *   → GET /api/stones/<id>/self 反映新内容。
 *
 * 确定性：stone 经 HTTP 直建 + 初值经 PUT 写入（皆走版本化 commit，避免直写未提交与 ff-merge 冲突）；
 * 无 LLM、无 thread。
 */

import { expect, test } from "./_fixture-client";

const OID = "editme";
const INITIAL = "# editme\n\n初始身份。\n";
const EDITED = "# editme\n\n编辑后的身份 —— A1 验证写入闭环。\n";

/** 经 backend HTTP 建 stone（committed 空 stone）。 */
async function createStoneViaHttp(backendUrl: string, objectId: string): Promise<void> {
  const res = await fetch(`${backendUrl}/api/stones`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objectId }),
  });
  if (!res.ok) throw new Error(`POST /api/stones failed: ${res.status} ${await res.text()}`);
}

/** 经版本化 PUT 写一个 stone 源文件（confirmOverwrite 控制覆盖护栏）。 */
async function putStoneFile(
  backendUrl: string,
  objectId: string,
  path: string,
  content: string,
  confirmOverwrite = false,
): Promise<Response> {
  return fetch(`${backendUrl}/api/stones/${objectId}/file`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(confirmOverwrite ? { "X-Overwrite-Confirm": "true" } : {}),
    },
    body: JSON.stringify({ path, content }),
  });
}

async function getStoneSelf(backendUrl: string, objectId: string): Promise<string> {
  const res = await fetch(`${backendUrl}/api/stones/${objectId}/self`);
  if (!res.ok) throw new Error(`GET self failed: ${res.status}`);
  const json = (await res.json()) as { text?: string };
  return json.text ?? "";
}

test.describe("File editor e2e (A1)", () => {
  test("A1 编辑 self.md → 保存（覆盖确认）→ GET self 反映新内容", async ({ page, world }) => {
    await world.startStack();
    const backendUrl = world.backendUrl();

    // 1) HTTP 直建 committed 空 stone，再经 PUT 写入初值（committed 基线）。
    await createStoneViaHttp(backendUrl, OID);
    const seedRes = await putStoneFile(backendUrl, OID, "self.md", INITIAL);
    expect(seedRes.ok).toBe(true);
    expect(await getStoneSelf(backendUrl, OID)).toBe(INITIAL);

    // 2) 完整 shell 打开该 stone self.md（versioning layout 路径）。
    await page.goto(`${world.webUrl()}/files/stones/main/objects/${OID}/self.md`);

    // 只读 markdown 预览 + 「编辑」入口先到位。
    await expect(page.getByRole("button", { name: "编辑" })).toBeVisible({ timeout: 20_000 });

    // 3) 进编辑态 → 改 CodeMirror 内容。
    await page.getByRole("button", { name: "编辑" }).click();
    const editor = page.locator(".code-editor .cm-content");
    await expect(editor).toBeVisible({ timeout: 10_000 });
    // 全选清空再输入新内容（CodeMirror contenteditable）。
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
    await editor.pressSequentially(EDITED);

    // 4) 已有内容 → 保存命中覆盖护栏 → window.confirm，自动确认。
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "保存" }).click();

    // 保存成功后退出编辑态：「编辑」入口重新出现（FileViewer await onSave resolve 才退出）。
    await expect(page.getByRole("button", { name: "编辑" })).toBeVisible({ timeout: 15_000 });

    // 5) 经 HTTP 核验落盘内容已改。
    await expect
      .poll(() => getStoneSelf(backendUrl, OID), { timeout: 15_000 })
      .toBe(EDITED);
  });
});
