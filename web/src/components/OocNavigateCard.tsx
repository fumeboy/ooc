/**
 * OocNavigateCard — 导航卡片组件
 *
 * 在消息中渲染 ooc:// 链接为可点击的卡片。
 * 用户点击"打开"按钮后导航到对应页面。
 */
import { useSetAtom } from "jotai";
import { editorTabsAtom, activeFilePathAtom } from "../store/session";
import { oocLinkUrlAtom } from "../store/ooc-link";
import { parseOocUrl } from "../lib/ooc-url";
import { ExternalLink } from "lucide-react";

interface OocNavigateCardProps {
  title: string;
  description?: string;
  url: string;
}

export function OocNavigateCard({ title, description, url }: OocNavigateCardProps) {
  const setEditorTabs = useSetAtom(editorTabsAtom);
  const setActiveFilePath = useSetAtom(activeFilePathAtom);
  const setOocLink = useSetAtom(oocLinkUrlAtom);

  const handleClick = () => {
    const parsed = parseOocUrl(url);
    if (!parsed) {
      /* 无法解析，降级到 OocLinkPreview */
      setOocLink(url);
      return;
    }

    if (parsed.type === "object") {
      const path = `stones/${parsed.name}`;
      setEditorTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev;
        return [...prev, { path, label: parsed.name }];
      });
      setActiveFilePath(path);
    } else if (parsed.type === "file") {
      const path = `stones/${parsed.objectName}/files/${parsed.filename}`;
      setEditorTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev;
        return [...prev, { path, label: parsed.filename }];
      });
      setActiveFilePath(path);
    } else if (parsed.type === "ui") {
      /* 从路径提取 sessionId 和 objectName：flows/{sid}/objects/{name}/ui/pages/{page} */
      const m = parsed.path.match(/^flows\/([^/]+)\/objects\/([^/]+)\/ui\/pages\/(.+)$/);
      if (m) {
        const path = `flows/${m[1]}/objects/${m[2]}`;
        const label = m[2]!;
        setEditorTabs((prev) => {
          if (prev.some((t) => t.path === path)) return prev;
          return [...prev, { path, label }];
        });
        setActiveFilePath(path + "?tab=UI");
      } else {
        setOocLink(url);
      }
    } else {
      /* 未知类型，降级到 OocLinkPreview */
      setOocLink(url);
    }
  };

  return (
    <div className="my-2 rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="shrink-0 w-8 h-8 rounded-md bg-[var(--primary)]/10 flex items-center justify-center">
          <ExternalLink className="w-4 h-4 text-[var(--primary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{title}</div>
          {description && (
            <div className="text-xs text-[var(--muted-foreground)] truncate">{description}</div>
          )}
        </div>
        <button
          onClick={handleClick}
          className="shrink-0 px-3 py-1 text-xs rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
        >
          打开
        </button>
      </div>
    </div>
  );
}
