/**
 * 路由错误兜底：未知 URL / loader 抛错时显示。plan-003 D7。
 *
 * Round 15 L3 (体验官 Round 14): 旧形态路径 `/sessions/xxx` 不再 redirect 到新
 * `/flows/xxx`，用户访问后只看到 "页面无法显示 / 回首页"，不知道正确路径在哪里。
 * 这里加几个 fallback 链接，并在 URL pattern 形如 `/sessions/<sid>` 时智能提示
 * 对应的 `/flows/<sid>`。
 */
import { Link, useLocation, useRouteError } from "react-router";

/**
 * 从当前路径推测用户想去的路径。当前规则（保持最简）：
 * - `/sessions/<sid>` (旧形态) → `/flows/<sid>` (Round 7 新形态)
 * - 其它 → undefined
 */
function guessIntendedPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/sessions\/([^/?#]+)/);
  if (m && m[1]) return `/flows/${m[1]}`;
  return undefined;
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const location = useLocation();
  const message = error instanceof Error ? error.message : String(error ?? "Unknown route");
  const guess = guessIntendedPath(location.pathname);
  return (
    <div className="p-6 text-sm" data-testid="route-error">
      <p className="text-red-500 font-medium">页面无法显示</p>
      <pre className="mt-2 text-xs whitespace-pre-wrap bg-[var(--muted)] p-3 rounded-lg overflow-auto max-h-60">
        {message}
      </pre>
      <div className="mt-3" data-testid="route-error-suggestions">
        <p className="muted small" style={{ marginBottom: 6 }}>你可能想去：</p>
        <ul style={{ listStyle: "disc", paddingLeft: 20, margin: 0 }}>
          {guess && (
            <li>
              <Link to={guess} className="link" data-testid="route-error-guess">
                {guess}
              </Link>
              <span className="muted small">（从旧形态 path 推测）</span>
            </li>
          )}
          <li>
            <Link to="/flows" className="link">/flows</Link>
            <span className="muted small">（Flows 列表）</span>
          </li>
          <li>
            <Link to="/" className="link">/</Link>
            <span className="muted small">（首页）</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
