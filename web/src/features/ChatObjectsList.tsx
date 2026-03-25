/**
 * ChatObjectsList — 网站左边栏 Chat 模式的对象列表
 *
 * 当有活跃会话时，展示该会话的参与对象（含状态、whoAmI），
 * 支持 All / 单对象过滤，与 ChatContent 共享 chatSelectedObjectAtom。
 * 无活跃会话时展示所有可对话对象。
 */
import { useAtom, useAtomValue } from "jotai";
import { objectsAtom } from "../store/objects";
import { activeSessionFlowAtom, chatSelectedObjectAtom } from "../store/session";
import { StatusBadge } from "../components/ui/Badge";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { cn } from "../lib/utils";

export function ChatObjectsList({ onSelect }: { onSelect?: () => void } = {}) {
  const objects = useAtomValue(objectsAtom);
  const activeFlow = useAtomValue(activeSessionFlowAtom);
  const [selectedObject, setSelectedObject] = useAtom(chatSelectedObjectAtom);

  /* 有活跃会话：展示参与对象 */
  if (activeFlow) {
    const participants: { name: string; status: string; isMain: boolean; whoAmI: string }[] = [];
    {
      const mainObj = objects.find((o) => o.name === activeFlow.stoneName);
      participants.push({
        name: activeFlow.stoneName,
        status: activeFlow.status,
        isMain: true,
        whoAmI: mainObj?.talkable?.whoAmI ?? "",
      });
    }
    if (activeFlow.subFlows) {
      for (const sf of activeFlow.subFlows) {
        if (sf.stoneName !== activeFlow.stoneName) {
          const obj = objects.find((o) => o.name === sf.stoneName);
          participants.push({
            name: sf.stoneName,
            status: sf.status,
            isMain: false,
            whoAmI: obj?.talkable?.whoAmI ?? "",
          });
        }
      }
    }

    /* 计算响应时间 */
    const getResponseTime = () => {
      if (!activeFlow.createdAt || !activeFlow.updatedAt) return null;
      const ms = activeFlow.updatedAt - activeFlow.createdAt;
      if (ms < 1000) return `${ms}ms`;
      return `${(ms / 1000).toFixed(1)}s`;
    };

    return (
      <div className="flex flex-col h-full w-full">
        <div className="px-3 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
            Objects
          </span>
          {getResponseTime() && (
            <span className="text-[10px] text-[var(--muted-foreground)]">{getResponseTime()}</span>
          )}
        </div>
        <div className="rounded-xl p-[6px] bg-black/[0.03] overflow-auto">
          <nav className="rounded-lg overflow-auto px-2 py-2 space-y-0.5"
            style={{ background: "#fefefe" }}
          >
          <button
            onClick={() => { setSelectedObject(null); onSelect?.(); }}
            className={cn(
              "w-full text-left px-2 py-[5px] text-xs flex items-center gap-2 rounded-[4px] transition-colors",
              selectedObject === null ? "bg-[var(--accent)] font-medium" : "hover:bg-[var(--accent)]/60",
            )}
          >
            All
          </button>
          {participants.map((p) => (
            <button
              key={p.name}
              onClick={() => { setSelectedObject(p.name); onSelect?.(); }}
              className={cn(
                "w-full text-left px-2 py-[5px] text-sm flex items-center gap-2 rounded-[4px] transition-colors",
                selectedObject === p.name ? "bg-[var(--accent)] font-medium" : "hover:bg-[var(--accent)]/60",
              )}
            >
              <ObjectAvatar name={p.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-xs truncate", selectedObject === p.name && "font-medium")}>{p.name}</span>
                  <StatusBadge status={p.status} />
                </div>
                {p.whoAmI && (
                  <span className="text-[10px] text-[var(--muted-foreground)] truncate block opacity-70">{p.whoAmI}</span>
                )}
              </div>
            </button>
          ))}
        </nav>
        </div>
      </div>
    );
  }

  /* 无活跃会话：展示所有可对话对象 */
  const sorted = [...objects]
    .filter((o) => o.name !== "user")
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pb-1.5">
        <span className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
          Objects
        </span>
      </div>
      <div className="rounded-xl p-[6px] bg-black/[0.03] overflow-auto">
        <nav className="rounded-lg overflow-auto px-2 py-2 space-y-0.5"
          style={{ background: "#fefefe" }}
        >
        {sorted.map((obj) => (
          <div
            key={obj.name}
            className="w-full text-left px-2 py-[5px] text-sm flex items-center gap-2 rounded-[4px] hover:bg-[var(--accent)]/60 transition-colors"
          >
            <ObjectAvatar name={obj.name} size="sm" />
            <div className="min-w-0 flex-1">
              <span className="truncate block text-xs">{obj.name}</span>
              {obj.talkable.whoAmI && (
                <span className="text-[10px] text-[var(--muted-foreground)] truncate block opacity-70">
                  {obj.talkable.whoAmI}
                </span>
              )}
            </div>
          </div>
        ))}
      </nav>
      </div>
    </div>
  );
}
