/**
 * 渲染一个 `ooc://client/...` URI 为 in-app 可点击链接。
 *
 * 走 react-router <Link>（client-side 导航，不整页 reload）。route 已由 parseOocUri 解析；
 * 此组件只负责呈现。title 保留原始 ooc:// URI，方便用户/调试看到原寻址。
 */

import { Link } from "react-router";

export function OocLink({
  to,
  uri,
  children,
}: {
  to: string;
  uri: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="ooc-link" to={to} title={uri}>
      {children}
    </Link>
  );
}
