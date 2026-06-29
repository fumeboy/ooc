/**
 * Vite `define` 注入的 world 根绝对路径。
 * 用于 ObjectClientRenderer 拼 `/@fs/${WORLD_ROOT}/stones/.../client/index.tsx`
 * 动态 import URL。
 *
 * 配置入口见 web/vite.config.ts（来源 env OOC_WORLD_DIR，与 backend 同名）。
 */
declare const __OOC_WORLD_ROOT__: string;

export const WORLD_ROOT: string = __OOC_WORLD_ROOT__;
