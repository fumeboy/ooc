/**
 * ObjectsPage — 对象详情页面
 *
 * 左侧对象列表已移至 App 的全局侧边栏，这里只渲染右侧详情。
 */
import { useAtom } from "jotai";
import { selectedObjectAtom } from "../store/objects";
import { ObjectDetail } from "./ObjectDetail";
import { ErrorBoundary } from "../components/ErrorBoundary";

export function ObjectsPage() {
  const [selectedObject] = useAtom(selectedObjectAtom);

  return (
    <div className="flex-1 h-full overflow-auto">
      <ErrorBoundary>
        {selectedObject ? (
          <ObjectDetail objectName={selectedObject} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[var(--muted-foreground)]">
              Select an object from the sidebar
            </p>
          </div>
        )}
      </ErrorBoundary>
    </div>
  );
}
