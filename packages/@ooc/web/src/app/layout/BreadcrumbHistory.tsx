import { useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * 弹层经 `createPortal` 渲染到 `document.body` + `position: fixed` 锚定触发按钮：
 * breadcrumb-bar 是 `.panel`（`overflow: hidden` + `backdrop-filter` stacking context），
 * 留在栏内的 `position: absolute` 下拉会被栏的 overflow 裁掉、并被下方 main-body 盖住
 * （z-index 困在栏的 stacking context 内无效）。portal 到 body 逃出裁剪与 stacking 上下文。
 * hover 从触发按钮跨到弹层之间有间隙时，用一个短延时（scheduleHide）避免误关。
 */
export function BreadcrumbHistory() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const [coords, setCoords] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const wrapRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHide() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function show() {
    cancelHide();
    const el = wrapRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      // 右对齐触发按钮右沿（与旧 `right: 0` 语义一致），落在按钮正下方 4px。
      setCoords({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setItems(readHistory());
    setOpen(true);
  }

  function scheduleHide() {
    cancelHide();
    hideTimer.current = setTimeout(() => setOpen(false), 140);
  }

  return (
    <span
      ref={wrapRef}
      className="breadcrumb-history"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={scheduleHide}
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
      {open &&
        createPortal(
          <div
            className="breadcrumb-history-pop"
            role="menu"
            style={{ position: "fixed", top: coords.top, right: coords.right, zIndex: 60 }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
          >
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
                      onClick={() => setOpen(false)}
                    >
                      {path}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
