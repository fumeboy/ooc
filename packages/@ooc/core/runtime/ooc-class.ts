/**
 * OOC class 装配契约 —— 一个 ooc class `index.ts` 的 `export const Class` 形状，
 * 以及 runtime 持有的「object 实例」。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`
 * 接口模板：同目录 `example.md`。
 *
 * class = self.md + readable + executable + visible + persistable + types.ts + index.ts
 * （object-model 核心 1）。本文件把后端三维度（executable / readable / persistable）+ 可选
 * constructor 收口成 `OocClass`，由各 class 的 `index.ts` 一处 `export const Class` 装配。
 * （visible 是前端，不在后端路由内。）
 */

import type {
  ExecutableModule,
  ObjectConstructor,
  ObjectLifecycleHook,
} from "../executable/contract.js";
import type { ReadableModule } from "../readable/contract.js";
import type { PersistableModule } from "../persistable/contract.js";
import type { VisibleServerModule } from "../_shared/types/visible-server.js";
import type { WindowStatus } from "../_shared/types/context-window.js";

/**
 * OOC World 运行时句柄 —— class 的 `init` 在 World 启动时拿到它。
 * 最小占位（机制实现时按需扩展：config / registry / runtime 句柄等）。
 */
export interface World {
  baseDir: string;
}

/**
 * 一个 ooc class 的后端程序路由（`index.ts` 的 `export const Class`）。
 *
 * - construct   : 仅**非单例** class 注册（`exec(ctx, args)` 产出新实例初始 Data）；单例 class 省略
 * - active      : 对象 session refcount 0→1 激活钩子（可选；由 object-lifecycle 在 refcount 0↔1 派发，seam=WindowManager.instantiate）
 * - unactive    : 对象 session refcount 1→0 停用钩子（可选；复用旧 destruct 槽；可返回 {delete:true} 自决删除）
 * - init        : **World 启动时执行**一次的 class 级初始化 `(world) => err`（返回错误信息，空=成功）；
 *                 用于起后台通道/长连接等（如 feishu_app 起 lark event relay）。机制（World 启动时
 *                 遍历调 init）待实现。
 * - executable  : object method（改数据 / 副作用；LLM 在 thinkloop 行使）
 * - readable    : 投影成 context window + window method
 * - persistable : 自定义序列化（省略走系统默认）
 * - visibleServer : 人类侧服务端 API（HTTP 控制面编辑 object data；无 thinkloop thread）
 *
 * 注：constructor 槽位命名为 **`construct`** 而非 `constructor` —— JS `Object.prototype.constructor`
 * 会遮蔽该键（`({}).constructor === Object` 恒真 → 单例无法被识别；TS 也会拿 `Function` 去比对类型而报错）。
 * example.md 示例里写的 `constructor:` 是该陷阱下的笔误，落地契约统一用 `construct`。
 */
export interface OocClass<Data = any> {
  construct?: ObjectConstructor<Data>;
  active?: ObjectLifecycleHook; // refcount 0→1 派发（object-lifecycle dispatchActiveIfFirst，seam=WindowManager.instantiate）
  unactive?: ObjectLifecycleHook;
  init?: (world: World) => string | Promise<string>;
  executable?: ExecutableModule<Data>;
  readable?: ReadableModule<Data>;
  persistable?: PersistableModule<Data>;
  visibleServer?: VisibleServerModule<Data>;
}

/**
 * `package.json` 的 `ooc` 元信息（object-model 细节补充）。
 * - kind  : 这份 stone 是 class（定义）还是 object（实例）
 * - class : object 经 ooc.class 继承的那**一个** class（父类 id，单跳继承）；省略=无父类（自身即终点，无隐式基类回退；_builtin/root 类已退役）
 */
export interface OocPackageMeta {
  objectId: string;
  kind: "class" | "object";
  class?: string;
}

/**
 * runtime 持有的 object **实例** —— 把「身份元信息 + 业务 Data + 投影态」三者显式分离
 * （object-model 核心 1/4）。取代旧的「BaseContextWindow 平铺业务字段」单体结构。
 *
 * - 元信息字段（id / class / title / status / createdAt / parentObjectId…）由 runtime 管理
 * - data : 业务数据（该 class 的 types.ts `Data`；object method 经 `self` 入参读写）
 * - win  : 投影态（window method 读写、readable 读；与 data 分离持久化）
 */
export interface OocObjectInstance<Data = unknown, Win = unknown> {
  id: string;
  class: string;
  parentObjectId?: string;
  title: string;
  status: WindowStatus;
  createdAt: number;
  data: Data;
  win?: Win;
  /** 结构窗保护：construct 标 false → close 原语拒关（缺省 undefined = 可关）。spec §5。 */
  closable?: boolean;
}
