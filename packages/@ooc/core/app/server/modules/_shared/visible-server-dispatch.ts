/**
 * visible/server method dispatch —— HTTP 控制面（人类侧 UI）调一个 object 的 visibleServer 方法。
 *
 * 与 thinkloop 的 object method dispatch（WindowManager）正交：这里**无 live thread / 无 runtime 句柄**，
 * 只编辑 object data：load 当前 data（persistable.load）→ exec 改入参 data（pass-by-ref）→
 * reportDataEdit eager 触发 persistable.save 落盘（非版本化）。A2 v1 仅 flow scope。
 *
 * 设计权威：`.ooc-world-meta/.../children/visible/self.md`（visible/server ctx 单一权威）。
 */
import type { ObjectRegistry } from "@ooc/core/runtime/object-registry";
import type { FlowObjectRef } from "@ooc/core/_shared/types/thread.js";
import { persistableCtx } from "@ooc/core/persistable/object-data.js";
import {
  normalizeMethodResult,
  type ObjectMethodResult,
} from "@ooc/core/executable/contract.js";
import { AppServerError } from "../../bootstrap/errors";

/**
 * 在 flow scope 下 dispatch 一个 visible/server method。
 *
 * @param registry  已 load 目标 class 的 registry（沿继承链解析 visibleServer / persistable）。
 * @param flowRef   目标 flow object 定位三元组（baseDir / sessionId / objectId）——直构、不依赖 thread。
 * @param classId   解析 visibleServer / persistable 的 class id（flow scope 下通常 = objectId）。
 * @param methodName 方法名。
 * @param args      调用参数。
 */
export async function dispatchVisibleServerMethod(
  registry: ObjectRegistry,
  flowRef: FlowObjectRef,
  classId: string,
  methodName: string,
  args: Record<string, unknown>,
): Promise<ObjectMethodResult> {
  const mod = registry.resolveVisibleServer(classId);
  const entry = mod?.methods.find((m) => m.name === methodName);
  if (!entry) {
    throw new AppServerError(
      "METHOD_NOT_FOUND",
      `visible/server method '${methodName}' not found on '${flowRef.objectId}'`,
      {
        sessionId: flowRef.sessionId,
        objectId: flowRef.objectId,
        method: methodName,
        available: (mod?.methods ?? []).map((m) => m.name),
      },
    );
  }

  // load 当前 data（无 persistable.load / 无盘上数据 → 空 Data，由 method 初始化字段）。
  const persistable = registry.resolvePersistable(classId);
  const ctx = persistableCtx(flowRef);
  const data = (await persistable?.load?.(ctx)) ?? {};

  // exec 改入参 data（pass-by-ref）→ reportDataEdit eager 落盘（与 thinkloop object method 一致约定）。
  const result = await entry.exec(
    {
      baseDir: flowRef.baseDir,
      session: { baseDir: flowRef.baseDir, sessionId: flowRef.sessionId },
      object: { id: flowRef.objectId, class: classId },
      args,
      reportDataEdit: async () => {
        await persistable?.save?.(persistableCtx(flowRef), data);
      },
    },
    data,
    args,
  );
  return normalizeMethodResult(result as never);
}
