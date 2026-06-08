import { useState } from "react";
import { Link } from "react-router";
import { History } from "lucide-react";
import { readHistory } from "../nav-history";

/**
 * BreadcrumbHistory — breadcrumb-bar 上 refresh 按钮右边的 history 按钮。
 *
 * hover（或 focus）时弹出最近访问的 path 列表（只 path，无 query / domain）。
 * 点击某条 path → react-router 跳转过去。数据源为 localStorage（见 ../nav-history）。
 *
 * 列表在每次打开时从 localStorage 读取（保证反映最新访问记录，无需订阅）。
 */
export function BreadcrumbHistory() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<string[]>([]);

  function show() {
    setItems(readHistory());
    setOpen(true);
  }
  function hide() {
    setOpen(false);
  }

  return (
    <span
      className="breadcrumb-history"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <button
        type="button"
        className="refresh"
        aria-label="Navigation history"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Recent paths"
        onClick={show}
      >
        <History size={14} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="breadcrumb-history-pop" role="menu">
          <div className="breadcrumb-history-title">Recent paths</div>
          {items.length === 0 ? (
            <div className="breadcrumb-history-empty muted small">No history yet</div>
          ) : (
            <ul className="breadcrumb-history-list">
              {items.map((path) => (
                <li key={path}>
                  <Link
                    to={path}
                    className="breadcrumb-history-item"
                    role="menuitem"
                    title={path}
                    onClick={hide}
                  >
                    {path}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
