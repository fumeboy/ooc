#!/usr/bin/env bun
/**
 * 薄 OOC 驱动 CLI（体验官可选用；等价于 cheatsheet.md 的 curl 配方）。
 *
 *   bun ooc-drive.ts stone   --port P --object assistant [--self "..."]
 *   bun ooc-drive.ts seed    --port P --session S --object assistant --text "task"
 *   bun ooc-drive.ts talk    --port P --session S --text "followup"
 *   bun ooc-drive.ts wait    --port P --session S [--timeout 240]
 *   bun ooc-drive.ts thread  --port P --session S --object assistant --tid T
 *
 * 注：内部用 fetch + NO_PROXY 绕 Clash。输出 JSON，体验官自行解析。
 */
process.env.NO_PROXY = "localhost,127.0.0.1";
process.env.no_proxy = "localhost,127.0.0.1";

const a = Bun.argv.slice(2);
const cmd = a[0];
const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
const port = get("port") ?? "3000";
const base = `http://localhost:${port}/api`;

async function post(path: string, body: unknown) {
  const r = await fetch(`${base}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function getj(path: string) {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: await r.json().catch(() => null) };
}

function statusOf(threadsBody: any): string {
  const items = threadsBody?.items ?? [];
  // 取最近活动 thread 的 status；优先非 done 以反映在跑
  const running = items.find((t: any) => t.status === "running" || t.status === "waiting");
  return running?.status ?? items[0]?.status ?? "unknown";
}

switch (cmd) {
  case "stone":
    console.log(JSON.stringify(await post("/stones", {
      objectId: get("object"), self: get("self") ?? `# ${get("object")}`,
    })));
    break;
  case "seed":
    console.log(JSON.stringify(await post("/sessions", {
      sessionId: get("session"), targetObjectId: get("object"), initialMessage: get("text"),
    })));
    break;
  case "talk":
    console.log(JSON.stringify(await post(`/flows/${get("session")}/continue`, { text: get("text") })));
    break;
  case "wait": {
    const deadline = Date.now() + Number(get("timeout") ?? 240) * 1000;
    let last = "";
    while (Date.now() < deadline) {
      const r = await getj(`/flows/${get("session")}/threads`);
      last = statusOf(r.body);
      if (/done|failed/.test(last)) break;
      await Bun.sleep(5000);
    }
    console.log(JSON.stringify({ status: last }));
    break;
  }
  case "thread":
    console.log(JSON.stringify(
      await getj(`/flows/${get("session")}/${get("object")}/threads/${get("tid")}`)));
    break;
  default:
    console.error("unknown command. see header for usage.");
    process.exit(2);
}
