/**
 * OOC class 装配契约 —— 一个 ooc class `index.ts` 的 `export const Class` 形状，
 * 以及 runtime 持有的「object 实例信封」。
 *
 * 设计权威：`.ooc-world-meta/.../children/class/knowledge/object-model.md`
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
  ObjectDestructor,
} from "../executable/contract.js";
import type { ReadableModule } from "../readable/contract.js";
import type { PersistableModule } from "../persistable/contract.js";
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
 * - destruct    : 对象销毁清理（与 construct 对应；暂仅接口，机制待实现）
 * - init        : **World 启动时执行**一次的 class 级初始化 `(world) => err`（返回错误信息，空=成功）；
 *                 用于起后台通道/长连接等（如 feishu_app 起 lark event relay）。机制（World 启动时
 *                 遍历调 init）待实现。
 * - executable  : object method（改数据 / 副作用）
 * - readable    : 投影成 context window + window method
 * - persistable : 自定义序列化（省略走系统默认）
 *
 * 注：constructor 槽位命名为 **`construct`** 而非 `constructor` —— JS `Object.prototype.constructor`
 * 会遮蔽该键（`({}).constructor === Object` 恒真 → 单例无法被识别；TS 也会拿 `Function` 去比对类型而报错）。
 * example.md 示例里写的 `constructor:` 是该陷阱下的笔误，落地契约统一用 `construct`。
 */
export interface OocClass<Data = any> {
  construct?: ObjectConstructor<Data>;
  destruct?: ObjectDestructor<Data>;
  init?: (world: World) => string | Promise<string>;
  executable?: ExecutableModule<Data>;
  readable?: ReadableModule<Data>;
  persistable?: PersistableModule<Data>;
}

/**
 * `package.json` 的 `ooc` 元信息（object-model 细节补充）。
 * - kind  : 这份 stone 是 class（定义）还是 object（实例）
 * - class : 继承谁（父类 id，单链继承）；省略=隐式继承基类
 */
export interface OocPackageMeta {
  objectId: string;
  kind: "class" | "object";
  class?: string;
}

/**
 * runtime 持有的 object **实例信封** —— 把「身份信封 + 业务 Data + 投影态」三者显式分离
 * （object-model 核心 1/4）。取代旧的「BaseContextWindow 平铺业务字段」单体结构。
 *
 * - 信封字段（id / class / title / status / createdAt / parentObjectId…）由 runtime 管理
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
}
