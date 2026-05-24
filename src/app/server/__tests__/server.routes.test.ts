import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo } from "@src/persistable";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

// 根因 #2：HTTP stone 写入现在必经 stone-versioning（worktree → commit → ff merge），
// 测试 helper 必须先 bootstrap stones/ bare repo + main worktree。
async function makeAppWithBaseDir() {
  const baseDir = mkdtempSync(join(tmpdir(), "ooc-app-server-routes-"));
  await ensureStoneRepo({ baseDir });
  const app = buildServer({
    ...readServerConfig(),
    port: 0,
    baseDir,
    workerPollMs: 5,
    workerEnabled: false,
  });
  return { app, baseDir };
}

async function makeApp() {
  return (await makeAppWithBaseDir()).app;
}

describe("app server routes", () => {
  test("GET /api/health returns ok", async () => {
    const app = await makeApp();
    const response = await app.handle(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("ooc-app-server");
  });

  test("runtime debug routes expose and toggle debug status", async () => {
    const app = await makeApp();

    const initial = await app.handle(new Request("http://localhost/api/runtime/debug/status"));
    const initialBody = await initial.json();
    const enabled = await app.handle(new Request("http://localhost/api/runtime/debug/enable", { method: "POST" }));
    const enabledBody = await enabled.json();
    const afterEnable = await app.handle(new Request("http://localhost/api/runtime/debug/status"));
    const afterEnableBody = await afterEnable.json();
    const disabled = await app.handle(new Request("http://localhost/api/runtime/debug/disable", { method: "POST" }));
    const disabledBody = await disabled.json();

    expect(initial.status).toBe(200);
    expect(initialBody.enabled).toBe(false);
    expect(enabled.status).toBe(200);
    expect(enabledBody.enabled).toBe(true);
    expect(afterEnable.status).toBe(200);
    expect(afterEnableBody.enabled).toBe(true);
    expect(disabled.status).toBe(200);
    expect(disabledBody.enabled).toBe(false);
  });

  test("GET /debug/chat.html returns the debug chat page", async () => {
    const app = await makeApp();
    const response = await app.handle(new Request("http://localhost/debug/chat.html"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("OOC Debug Chat");
    expect(html).toContain("Create Object");
    expect(html).toContain("Create Session");
    expect(html).toContain("Process Events");
    expect(html).toContain("Thread Context");
    expect(html).toContain("Auto refresh");
    expect(html).toContain("autoRefresh");
    expect(html).toContain("setInterval");
    expect(html).toContain("threadStatus");
    expect(html).toContain("/api/stones");
    expect(html).toContain("/api/flows/");
    expect(html).toContain("/threads/root/continue");
    expect(html).toContain("/api/runtime/jobs/");
  });

  test("GET /api/stones lists created objects for debug UI selection", async () => {
    const app = await makeApp();
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "debug-object-a" }),
      })
    );
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "debug-object-b" }),
      })
    );

    const response = await app.handle(new Request("http://localhost/api/stones"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((item: { objectId: string }) => item.objectId)).toEqual([
      "debug-object-a",
      "debug-object-b",
    ]);
  });

  test("POST /api/stones rejects missing object identity", async () => {
    const app = await makeApp();
    const response = await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  test("POST /api/flows creates session", async () => {
    const app = await makeApp();
    const response = await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-routes", title: "Routes Session" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe("session-routes");
    expect(body.created).toBe(true);
  });

  test("POST /api/stones/:id/call_method returns 404 for missing method", async () => {
    const app = await makeApp();
    // 先创建一个 stone（不写任何 ui_methods）
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "stone-no-methods" }),
      })
    );
    const response = await app.handle(
      new Request("http://localhost/api/stones/stone-no-methods/call_method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "ghost", args: {} }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("METHOD_NOT_FOUND");
    expect(body.error.message).toContain("ghost");
    expect(body.error.details.objectId).toBe("stone-no-methods");
  });

  test("POST /api/flows/:sid/objects/:id/call_method returns 404 for missing method", async () => {
    const app = await makeApp();
    // 先创建 stone + flow session
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "flow-no-methods" }),
      })
    );
    await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s-call", title: "S" }),
      })
    );
    await app.handle(
      new Request("http://localhost/api/flows/s-call/objects/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "flow-no-methods" }),
      })
    );
    const response = await app.handle(
      new Request(
        "http://localhost/api/flows/s-call/objects/flow-no-methods/call_method",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "ghost", args: {} }),
        }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("METHOD_NOT_FOUND");
    expect(body.error.details.objectId).toBe("flow-no-methods");
  });

  test("GET /api/flows lists flow sessions from world directory", async () => {
    const { app, baseDir } = await makeAppWithBaseDir();
    const sessionDir = join(baseDir, "flows", "web-session");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, ".session.json"), JSON.stringify({ title: "Web Session" }));

    const response = await app.handle(new Request("http://localhost/api/flows"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sessionId).toBe("web-session");
    expect(body.items[0].title).toBe("Web Session");
    expect(body.items[0].dir).toBe(sessionDir);
    expect(typeof body.items[0].createdAt).toBe("number");
    expect(typeof body.items[0].updatedAt).toBe("number");
  });

  test("GET /api/tree reads scoped world directory trees with markers", async () => {
    const { app, baseDir } = await makeAppWithBaseDir();
    await mkdir(join(baseDir, "flows", "web-session"), { recursive: true });
    await mkdir(join(baseDir, "stones", "assistant"), { recursive: true });
    await writeFile(join(baseDir, "flows", "web-session", "notes.txt"), "hello web");

    const flowsResponse = await app.handle(new Request("http://localhost/api/tree?scope=flows"));
    const flowsTree = await flowsResponse.json();
    const worldResponse = await app.handle(new Request("http://localhost/api/tree?scope=world"));
    const worldTree = await worldResponse.json();

    expect(flowsResponse.status).toBe(200);
    expect(flowsTree.name).toBe("flows");
    expect(flowsTree.type).toBe("directory");
    expect(flowsTree.children[0].name).toBe("web-session");
    expect(flowsTree.children[0].path).toBe("flows/web-session");
    expect(flowsTree.children[0].marker).toBe("flow");
    expect(worldResponse.status).toBe(200);
    expect(worldTree.children.map((node: { name: string }) => node.name)).toEqual(["flows", "stones"]);
  });

  test("GET /api/tree/file reads text files and reports missing or unsafe paths", async () => {
    const { app, baseDir } = await makeAppWithBaseDir();
    await mkdir(join(baseDir, "flows", "web-session"), { recursive: true });
    await writeFile(join(baseDir, "flows", "web-session", "notes.txt"), "hello web");

    const ok = await app.handle(new Request("http://localhost/api/tree/file?path=flows/web-session/notes.txt"));
    const okBody = await ok.json();
    const missing = await app.handle(new Request("http://localhost/api/tree/file?path=missing.txt"));
    const missingBody = await missing.json();
    const escape = await app.handle(new Request("http://localhost/api/tree/file?path=../escape.txt"));
    const escapeBody = await escape.json();

    expect(ok.status).toBe(200);
    expect(okBody.path).toBe("flows/web-session/notes.txt");
    expect(okBody.content).toBe("hello web");
    expect(okBody.size).toBe(9);
    expect(missing.status).toBe(404);
    expect(missingBody.error.code).toBe("NOT_FOUND");
    expect(escape.status).toBe(400);
    expect(escapeBody.error.code).toBe("INVALID_INPUT");
  });

  test("POST /api/stones creates object with self and readme content (data.json 已迁到 flow 层)", async () => {
    const { app, baseDir } = await makeAppWithBaseDir();

    const response = await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "writer",
          self: "# Writer\nI write notes.",
          readme: "# Writer README",
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.objectId).toBe("writer");
    expect(await readFile(join(baseDir, "stones", "main", "objects", "writer", "self.md"), "utf8")).toBe("# Writer\nI write notes.");
    expect(await readFile(join(baseDir, "stones", "main", "objects", "writer", "readme.md"), "utf8")).toBe("# Writer README");
    // 2026-05-23：stone 级 data.json 已删除；description 字段已从 schema 移除（无承载位置）。
    // name 在没有显式 self 时会写成 self.md 首行（display_name_from_self_md 协议）；
    // 本 case 显式传了 self，因此 self 优先。
    // knowledge 已迁到 pool 层；createPoolObject 在 createStone 中创建。
    expect((await stat(join(baseDir, "pools", "objects", "writer", "knowledge", "memory"))).isDirectory()).toBe(true);
  });

  test("POST /api/stones/:id/knowledge creates files and folders only under knowledge", async () => {
    const { app, baseDir } = await makeAppWithBaseDir();
    await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "researcher" }),
      })
    );

    const folder = await app.handle(
      new Request("http://localhost/api/stones/researcher/knowledge/directories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "notes" }),
      })
    );
    const file = await app.handle(
      new Request("http://localhost/api/stones/researcher/knowledge/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "notes/idea.md", content: "# Idea" }),
      })
    );
    const update = await app.handle(
      new Request("http://localhost/api/stones/researcher/knowledge/files", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-overwrite-confirm": "true" },
        body: JSON.stringify({ path: "notes/idea.md", content: "# Updated" }),
      })
    );
    const escape = await app.handle(
      new Request("http://localhost/api/stones/researcher/knowledge/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "../escape.md", content: "bad" }),
      })
    );
    const escapeBody = await escape.json();

    expect(folder.status).toBe(200);
    expect(file.status).toBe(200);
    expect(update.status).toBe(200);
    // 2026-05-23: knowledge 已迁到 pool 层；HTTP API 入口名保留 "knowledge"，但落点是 pools/objects/<id>/knowledge/。
    expect(await readFile(join(baseDir, "pools", "objects", "researcher", "knowledge", "notes", "idea.md"), "utf8")).toBe("# Updated");
    expect(escape.status).toBe(400);
    expect(escapeBody.error.code).toBe("INVALID_INPUT");
  });
});
