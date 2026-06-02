/**
 * 用 Playwright 直接打开一个已经存在、LLM 已经回完的 session URL，
 * 观察 supervisor talk window 是否渲染了 transcript。
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sid = process.argv[2] ?? "_test_experience_1780366303894";
const outDir = process.argv[3] ?? "/tmp/ooc-peek";
mkdirSync(outDir, { recursive: true });

const errors: any[] = [];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      errors.push({ kind: "console", type: m.type(), text: m.text() });
    }
  });
  page.on("pageerror", (err) => errors.push({ kind: "pageerror", message: err.message }));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push({ kind: "network", status: r.status(), url: r.url() });
  });

  await page.goto(`http://localhost:5173/flows/${sid}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // try to click the supervisor talk thread row to open transcript
  const supervisorRow = await page.evaluate(() => {
    // 找 user-talk 的容器
    const all = Array.from(document.querySelectorAll("*"));
    const candidate = all.find((el) => el.textContent?.trim() === "user-talk");
    if (!candidate) return null;
    return {
      tag: candidate.tagName,
      classes: (candidate as HTMLElement).className,
      bounds: candidate.getBoundingClientRect(),
    };
  });

  await page.screenshot({ path: join(outDir, "01_initial.png"), fullPage: true });

  // 想点击 user-talk 看是否能展开 transcript
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const candidate = all.find((el) => el.textContent?.trim() === "user-talk");
    (candidate as HTMLElement | null)?.click();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, "02_after-click.png"), fullPage: true });

  // dump body text
  const dom = await page.evaluate(() => ({
    url: location.href,
    bodyText: document.body.innerText,
    htmlSnippet: document.querySelector("main")?.outerHTML?.slice(0, 4000) || "no main",
  }));

  writeFileSync(join(outDir, "dom.json"), JSON.stringify({ supervisorRow, dom, errors }, null, 2));

  await browser.close();
  console.log("done; errors:", errors.length);
  console.log(JSON.stringify(errors, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
