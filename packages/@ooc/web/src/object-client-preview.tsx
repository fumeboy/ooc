/**
 * Object Client 预览页（plan §4 层 4 接入点）。
 *
 * 用法（Playwright e2e + 手工 demo 共用）：
 *
 *   /object-client.html?scope=stone&objectId=<id>
 *   /object-client.html?scope=flow&sessionId=<sid>&objectId=<oid>&page=<page>
 *
 * 故意不接 shell.tsx —— 避免大改主 UI；预览页只验证 ObjectClientRenderer 自身行为。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import {
  ObjectClientRenderer,
  type ClientTarget,
} from "./domains/clients/ObjectClientRenderer";
import "./styles.css";

function parseTarget(): ClientTarget | { error: string } {
  const params = new URLSearchParams(window.location.search);
  const scope = params.get("scope");
  const objectId = params.get("objectId");

  if (!scope || !objectId) {
    return { error: "缺少 scope / objectId 查询参数" };
  }

  if (scope === "stone") {
    return { scope: "stone", objectId };
  }

  if (scope === "flow") {
    const sessionId = params.get("sessionId");
    const page = params.get("page");
    if (!sessionId || !page) {
      return { error: "flow scope 需要 sessionId + page 参数" };
    }
    return { scope: "flow", sessionId, objectId, page };
  }

  return { error: `unknown scope '${scope}'，仅支持 stone | flow` };
}

function Preview() {
  const target = parseTarget();
  if ("error" in target) {
    return (
      <div className="p-6 text-sm" data-testid="preview-arg-error">
        <p className="text-red-500 font-medium">预览参数错误</p>
        <p className="mt-2 text-[var(--muted-foreground)]">{target.error}</p>
      </div>
    );
  }
  return (
    <div className="p-4" data-testid="preview-root">
      <ObjectClientRenderer target={target} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* StoneFallback / NotProducedYet 等 fallback 用 react-router 的 <Link>；
        预览页不接 shell.tsx，需自带一个最小 router context 才不致 useContext 为 null。
        MemoryRouter 即可——预览页里这些 Link 仅展示语义入口，不需要真导航。 */}
    <MemoryRouter>
      <Preview />
    </MemoryRouter>
  </StrictMode>,
);
