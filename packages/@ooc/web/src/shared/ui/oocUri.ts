/**
 * `ooc://` 原生对象/页面寻址 URI 的解析。
 *
 * `ooc://` 是 OOC 暴露给 Agent 知识侧的稳定寻址协议——Agent 只产出 `ooc://client/...`
 * 字符串，前端在这里 1:1 映射成 SPA in-app 路由，不让 react-router path / 端口细节漏进
 * Agent 知识（见 src/thinkable/knowledge/basic-knowledge.ts:332 的 flow 形态）。
 *
 * URI 契约（权威见 .ooc-world-meta visible 对象 knowledge/ooc-uri-addressing.md）：
 * - ooc://client/flows/<sid>/<self>/pages/<name>  ↔  /flows/<sid>/<self>/pages/<name>
 * - ooc://client/stones/<self>[/]                          ↔  /stones/<self>
 *
 * 只处理 `ooc://client/...`；其它任何形态返回 null（调用方降级为纯文本，不抛错不吞错）。
 * 纯函数，无 React/router 依赖，便于单测。
 */

/** 解析结果：可直接喂给 react-router <Link to=...> 的 app-internal 路径。 */
export type OocRoute = string;

const CLIENT_PREFIX = "ooc://client/";

/**
 * 把单个 `ooc://client/...` URI 映射为 SPA 路径；不识别返回 null。
 *
 * 设计要点：
 * - 段用 encodeURIComponent 重新编码，确保含特殊字符的 id 也能安全进 URL。
 * - 输入里的每段先 decodeURIComponent 还原（容忍 Agent 已编码或未编码两种写法）。
 * - 末尾斜杠（stone 形态常见）忽略。
 */
export function parseOocUri(raw: string): OocRoute | null {
  if (typeof raw !== "string" || !raw.startsWith(CLIENT_PREFIX)) return null;

  const rest = raw.slice(CLIENT_PREFIX.length).replace(/\/+$/, "");
  if (rest.length === 0) return null;

  const rawSegments = rest.split("/");
  let segments: string[];
  try {
    segments = rawSegments.map((s) => decodeURIComponent(s));
  } catch {
    // 非法 percent-encoding —— 降级为纯文本
    return null;
  }
  if (segments.some((s) => s.length === 0)) return null;

  // flows/<sid>/<self>/pages/<name>
  if (
    segments.length === 5 &&
    segments[0] === "flows" &&
    segments[3] === "pages"
  ) {
    const [, sid, self, , page] = segments as [string, string, string, string, string];
    return `/flows/${enc(sid)}/${enc(self)}/pages/${enc(page)}`;
  }

  // stones/<self>
  if (segments.length === 2 && segments[0] === "stones") {
    return `/stones/${enc(segments[1]!)}`;
  }

  return null;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

/** 判断一个字符串是否为可解析的 ooc://client URI（不分配中间结果）。 */
export function isOocUri(raw: string): boolean {
  return parseOocUri(raw) !== null;
}
