/**
 * viewport 协议 re-export — file_window / knowledge_window 共享的"精细化窗口大小"控制。
 *
 * 纯类型 + 纯函数（`Viewport` / `mergeViewport` / `applyViewport` / …）的 canonical 源是
 * `@ooc/core/_shared/types/viewport.ts`；此处 re-export 保持旧 import 路径可用。
 * 各 class 的 readable 经新 `WindowMethod`（`readable/contract.ts`，签名
 * `(ctx, self, before_win, args) => Win`）自行装配 set_viewport，不再走集中执行体。
 */

export * from "../_shared/types/viewport.js";
