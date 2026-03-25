/**
 * ObjectsObjectsList — Objects 页面的对象列表
 *
 * 详细展示：Avatar + 对象名 + whoAmI 描述，点击选中查看详情。
 */
import { useAtom, useAtomValue } from "jotai";
import { objectsAtom, selectedObjectAtom } from "../store/objects";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { cn } from "../lib/utils";

export function ObjectsObjectsList({ onSelect }: { onSelect?: () => void } = {}) {
  const objects = useAtomValue(objectsAtom);
  const [selected, setSelected] = useAtom(selectedObjectAtom);

  /* user 置顶，其余按名称排序 */
  const sorted = [...objects].sort((a, b) => {
    if (a.name === "user") return -1;
    if (b.name === "user") return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full w-full">
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
          <button
            key={obj.name}
            onClick={() => { setSelected(obj.name); onSelect?.(); }}
            className={cn(
              "w-full text-left px-2 py-[5px] text-sm flex items-center gap-2 rounded-[4px] transition-colors",
              selected === obj.name
                ? "bg-[var(--accent)] font-medium"
                : "hover:bg-[var(--accent)]/60",
            )}
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
          </button>
        ))}
      </nav>
      </div>
    </div>
  );
}
