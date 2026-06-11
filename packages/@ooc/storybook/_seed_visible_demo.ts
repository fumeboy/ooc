/**
 * Seed a demo session on the running backend (localhost:3000) that showcases:
 *   1. user asks sb_demo to show its visible UI
 *   2. sb_demo replies with a [[ui file-link]] pointing at stones/sb_demo/visible/index.tsx
 *
 * Clicking the file-link in the chat panel should open the rendered React component
 * (via ClientWithSourceToggle inside FileViewer) rather than raw tsx source.
 *
 * Run: bun run packages/@ooc/storybook/_seed_visible_demo.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

const BACKEND = "http://localhost:3000";
const SESSION_ID = "visible-capability-demo-" + Math.floor(Date.now() / 1000);
const TARGET = "sb_demo";

async function req(method: string, path: string, body?: any): Promise<any> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const r = await fetch(BACKEND + path, init);
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text), text }; } catch { return { status: r.status, text }; }
}

async function main() {
  // Step 1: seed the session (user → sb_demo initial talk)
  const seed = await req("POST", "/api/sessions", {
    sessionId: SESSION_ID,
    title: `Visible capability demo: file-link → rendered preview`,
    targetObjectId: TARGET,
    initialMessage: "请展示你自己写的 visible React 组件，用 file-link 把它指给我看。",
  });
  console.log("seed:", seed.status, seed.json?.sessionId ?? seed.text);
  if (seed.status >= 300) process.exit(1);

  // Step 2: user continues with a follow-up message that gives context
  const cont = await req("POST", `/api/flows/${SESSION_ID}/continue`, {
    text: "最好点一下那个 file-link 就能看到组件被渲染出来的样子，而不是源代码。",
  });
  console.log("continue:", cont.status);

  // Step 3: 直接把 sb_demo 的"回复"写进双方 thread —— sb_demo 没有 thinkable，不会自己回。
  // 先通过直接文件系统写入 thread.json 的方式追加消息。
  const replyText = [
    "好的，这是我为自己写的 visible React 组件：",
    "",
    "👉 [[ui{\"comp\":\"file-link\",\"path\":\"stones/sb_demo/visible/index.tsx\",\"label\":\"sb_demo 的 visible 组件（点击预览）\"}ui]]",
    "",
    "点击上面的链接会直接渲染出我写的 React 组件（而不是 tsx 源码）。",
    "组件里有一个可交互的输入框 + 按钮，会调用我自己 executable 里的 greet 方法展示结果——",
    "这演示了 visible（UI）↔ executable（行为）的闭环能力。",
  ].join("\n");

  // 通过 POST /api/flows/:sid/talk-windows 追加一个 sb_demo 主动发的消息——不行，那个只从 user→target。
  // 换方式：直接用 deliverTalkMessage 反方向投递（sb_demo as source, user as target）。
  // 但 HTTP 侧没有这个 API。直接写磁盘：通过 backend 跑一段 ad-hoc 代码。
  // 最简单：直接用 backend 的 POST /api/stones/:id/call_method 跑一个"发送回复"的方法。
  // sb_demo 没这个方法——我们直接用文件系统追加到双方 thread。

  // 先找到 sb_demo 和 user 的 thread 路径
  const LIVE = "/Users/bytedance/x/ooc/ooc-2/.ooc-world-live";
  const sbThreadsDir = join(LIVE, "flows", SESSION_ID, "objects", TARGET, "threads");
  const userThreadsDir = join(LIVE, "flows", SESSION_ID, "objects", "user", "threads");

  // 找到 sb_demo 下的 callee thread 和 user 的 root thread
  const { readdir, readFile } = await import("node:fs/promises");
  async function findThread(dir: string): Promise<string | null> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) return join(dir, e.name);
      }
    } catch {}
    return null;
  }
  const sbThreadDir = await findThread(sbThreadsDir);
  const userThreadDir = await findThread(userThreadsDir);
  console.log("sb_thread:", sbThreadDir);
  console.log("user_thread:", userThreadDir);

  if (!sbThreadDir || !userThreadDir) {
    console.error("could not find thread dirs — skipping manual reply injection");
  } else {
    // 从 sb_demo thread 上拿 talk window 的 id（window id = talk_window id，用于
    // formatter 把 outbox 消息映射到 target）。
    // contextWindows 已迁出 thread.json → 读 thread-context.json（talk 是 builtin
    // feature，完整 inline，含 id/type）。
    const sbThread = JSON.parse(await readFile(join(sbThreadDir, "thread.json"), "utf8"));
    let sbContextWindows: any[] = [];
    try {
      const ctx = JSON.parse(await readFile(join(sbThreadDir, "thread-context.json"), "utf8"));
      sbContextWindows = Array.isArray(ctx?.contextWindows) ? ctx.contextWindows : [];
    } catch {
      sbContextWindows = [];
    }
    const talkWindowId =
      sbContextWindows.find((w: any) => w.class === "talk")?.id ??
      (sbThread.creatorWindowId as string | undefined) ??
      "";

    // 读取双方 thread.json，追加一条符合 ThreadMessage 类型的消息。
    // 字段用 canonical ThreadMessage 定义：content（不是 text）、createdAt（毫秒数字
    // 不是 ISO 字符串）、source / fromObjectId / toObjectId / windowId。
    const now = Date.now();
    const msgId = "m_visible_demo_" + now + "_" + Math.random().toString(36).slice(2, 6);
    for (const td of [sbThreadDir, userThreadDir]) {
      const tfile = join(td, "thread.json");
      try {
        const data = JSON.parse(await readFile(tfile, "utf8"));
        const threadMsg = {
          id: msgId,
          fromThreadId: td === sbThreadDir ? sbThread.id : "root",
          toThreadId: td === sbThreadDir ? "root" : sbThread.id,
          fromObjectId: TARGET,
          toObjectId: "user",
          content: replyText,
          createdAt: now,
          source: "talk" as const,
          windowId: talkWindowId,
        };
        if (!Array.isArray(data.messages)) data.messages = [];
        data.messages.push(threadMsg);
        // sb_demo 侧: outbox; user 侧: inbox
        if (td === sbThreadDir) {
          if (!Array.isArray(data.outbox)) data.outbox = [];
          data.outbox.push(threadMsg);
          data.status = "paused";
        } else {
          if (!Array.isArray(data.inbox)) data.inbox = [];
          data.inbox.push(threadMsg);
        }
        await mkdir(dirname(tfile), { recursive: true });
        await writeFile(tfile, JSON.stringify(data, null, 2) + "\n", "utf8");
        console.log("appended reply to", tfile);
      } catch (e) {
        console.error("failed to patch", tfile, e);
      }
    }
  }

  console.log(`\nDone. Session: http://localhost:5173/flows/${SESSION_ID}`);
  console.log("The last message in the chat contains a file-link to sb_demo/visible/index.tsx.");
  console.log("Clicking it should show the rendered React component (not raw source).");
}

main().catch(e => { console.error(e); process.exit(1); });
