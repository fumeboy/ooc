/**
 * 路由错误兜底：未知 URL / loader 抛错时显示。plan-003 D7。
 */
import { Link, useRouteError } from "react-router";

export function RouteErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error ?? "Unknown route");
  return (
    <div className="p-6 text-sm" data-testid="route-error">
      <p className="text-red-500 font-medium">页面无法显示</p>
      <pre className="mt-2 text-xs whitespace-pre-wrap bg-[var(--muted)] p-3 rounded-lg overflow-auto max-h-60">
        {message}
      </pre>
      <p className="mt-3">
        <Link to="/" className="link">回首页</Link>
      </p>
    </div>
  );
}
