/**
 * src/extendable/base/ — 内置 OOC Objects（2026-05-28 ooc-6 Object Unification）。
 *
 * 原 src/executable/windows/ 下的 builtin window types 会逐个迁移到本目录，
 * 按新的 object 目录结构组织：
 *   src/extendable/base/<type>/
 *   ├── executable/index.ts  # methods 实现
 *   ├── visible/index.tsx    # UI 渲染组件
 *   ├── readable.ts          # 动态上下文渲染函数
 *   ├── readable.md          # 静态展示文本
 *   └── types.ts             # 类型定义
 *
 * Phase 1: 目录结构创建，_shared/ 作为 re-export 存在。
 * Phase 4: 逐个迁移 builtin types。
 */

export * from "./_shared";

// Side-effect imports: each builtin object 通过 registerObjectType 注入 methods / hooks。
// 这些 import 必须在 _shared 之后 load，确保使用时表已就绪。
// root 必须最先 load，因为其它 type 可能间接依赖 ROOT_COMMANDS。
import "./root/index.js";
import "./command_exec/index.js";
import "./todo/index.js";
import "./program/index.js";
import "./file/index.js";
import "./knowledge/index.js";
import "./search/index.js";
import "./custom/index.js";
import "./skill_index/index.js";
import "./plan/index.js";
