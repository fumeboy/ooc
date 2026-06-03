/**
 * Client/visible entry path matching — 统一 stone visible/index.tsx (canonical) /
 * client/index.tsx (legacy) 以及 flow visible/pages/<name>.tsx / client/pages/<name>.tsx
 * 的路径识别，避免 routing.ts / ClientWithSourceToggle / shell.tsx 三处 regex 漂移。
 *
 * 两种 layout 都支持：
 *   Flat (canonical):     stones/<objectId>/visible/index.tsx
 *   Versioning (git):     stones/<branch>/objects/<objectId>/visible/index.tsx
 *   Legacy fallback:      same but `client/` instead of `visible/`
 *
 * Flow pages:
 *   flows/<sessionId>/<objectId>/visible/pages/<page>.tsx
 *   (legacy) flows/<sid>/<oid>/client/pages/<page>.tsx
 *
 * 注意：只匹配 world-relative 路径（不含 leading `/`，不含 `/@fs/` 前缀）。
 */

import type { ClientTarget } from "./ObjectClientRenderer";

/** 只识别顶层 objectId（不支持 nested children —— nested children 尚无 visible 约定）。 */
const STONE_PATTERNS = [
  // canonical flat
  /^stones\/([^/]+)\/visible\/index\.tsx$/,
  // canonical versioning
  /^stones\/[^/]+\/objects\/([^/]+)\/visible\/index\.tsx$/,
  // legacy flat
  /^stones\/([^/]+)\/client\/index\.tsx$/,
  // legacy versioning
  /^stones\/[^/]+\/objects\/([^/]+)\/client\/index\.tsx$/,
];

const FLOW_PATTERNS = [
  /^flows\/([^/]+)\/([^/]+)\/visible\/pages\/([A-Za-z0-9_-]+)\.tsx$/,
  // legacy
  /^flows\/([^/]+)\/([^/]+)\/client\/pages\/([A-Za-z0-9_-]+)\.tsx$/,
];

/** Return structured ClientTarget when `path` is a stone or flow Object visible/client entry. */
export function matchClientTarget(path: string): ClientTarget | undefined {
  for (const re of STONE_PATTERNS) {
    const m = re.exec(path);
    if (m) return { scope: "stone", objectId: m[1]! };
  }
  for (const re of FLOW_PATTERNS) {
    const m = re.exec(path);
    if (m) {
      return {
        scope: "flow",
        sessionId: m[1]!,
        objectId: m[2]!,
        page: m[3]!,
      };
    }
  }
  return undefined;
}

/** True iff `matchClientTarget(path)` returns a target. */
export function isClientEntryPath(path: string): boolean {
  return matchClientTarget(path) !== undefined;
}

/**
 * 从 ClientTarget 反向推导 world-relative 路径。
 * 用 canonical flat layout + visible/ (新路径)，保证 shell.tsx shortcut → 长路径
 * 推导和 toPath shortcut 方向一致。
 */
export function deriveClientPath(target: ClientTarget): string {
  if (target.scope === "stone") {
    return `stones/${target.objectId}/visible/index.tsx`;
  }
  return `flows/${target.sessionId}/${target.objectId}/visible/pages/${target.page}.tsx`;
}

/**
 * If `path` is a client entry, return the shortcut URL (`/stones/<id>` or
 * `/flows/<sid>/<oid>/pages/<page>`); otherwise undefined. Used by toPath() for
 * the file-link → rendered preview jump.
 */
export function normalizeClientFilePath(path: string): string | undefined {
  const t = matchClientTarget(path);
  if (!t) return undefined;
  if (t.scope === "stone") return `/stones/${encodeURIComponent(t.objectId)}`;
  return `/flows/${encodeURIComponent(t.sessionId)}/${encodeURIComponent(t.objectId)}/pages/${encodeURIComponent(t.page)}`;
}
