/**
 * Form 管理器
 *
 * 管理指令生命周期的 form 模型。
 * 每个指令通过 begin/applyRefine/submit/cancel 四阶段执行：
 * - begin：创建 form，loading 相关 trait（open tool 触发）
 * - applyRefine：累积 args 但不执行；重算命令路径（refine tool 触发）
 * - submit：按最终 args 执行指令，form 结束（引用计数 -1）
 * - cancel：放弃执行，form 结束（等价 submit，但不触发指令）
 *
 * 同类型 form 共享 trait 加载（引用计数）。
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#第二部分-process过程
 */

import { deriveCommandPaths } from "../executable/commands/index.js";

/** 活跃的 Form */
export interface ActiveForm {
  /** Form 唯一标识 */
  formId: string;
  /** 指令类型（如 "talk", "program"） */
  command: string;
  /** 描述（begin 时提供） */
  description: string;
  /** 创建时间戳 */
  createdAt: number;
  /** program trait/method 专用：目标 trait */
  trait?: string;
  /** program trait/method 专用：方法名 */
  method?: string;

  /**
   * 累积的 args（Phase 4 渐进式填表）
   *
   * applyRefine 把本次 args 与现有累积合并（后者覆盖前者同名字段）；
   * 最终 submit 时把累积 args 交付给指令执行器。
   * 未经 refine 的 form 保持 `{}`。
   */
  accumulatedArgs: Record<string, unknown>;

  /**
   * 当前激活的 path 集合（由 deriveCommandPaths(command, accumulatedArgs) 算出）
   *
   * begin 时 = match(command, {})；refine 后用最新累积 args 重算。
   * Activator 反向索引基于这些 path 决定激活哪些 trait。
   * 多路径并行：如 ["talk", "talk.continue", "talk.continue.relation_update"]。
   */
  commandPaths: string[];

  /**
   * 本 form 已加载的 trait ID 列表（Phase 4）
   *
   * 用于 submit / cancel 时批量释放——避免因渐进填表
   * 触发的临时 trait 在 form 结束后仍残留 context。
   * begin 时由 engine 写入初始加载集；applyRefine 新增追加；关闭时参考此字段。
   */
  loadedTraits: string[];
}

/** 生成 form_id */
function generateFormId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Form 管理器 */
export class FormManager {
  private forms = new Map<string, ActiveForm>();
  private commandRefCount = new Map<string, number>();

  /** 开启 form，返回 form_id */
  begin(command: string, description: string, extra?: { trait?: string; method?: string }): string {
    const formId = generateFormId();
    this.forms.set(formId, {
      formId,
      command,
      description,
      createdAt: Date.now(),
      accumulatedArgs: {},
      commandPaths: deriveCommandPaths(command, {}).length > 0 ? deriveCommandPaths(command, {}) : [command],
      loadedTraits: [],
      ...extra,
    });
    this.commandRefCount.set(command, (this.commandRefCount.get(command) ?? 0) + 1);
    return formId;
  }

  /**
   * Refine: 累积 args 但不执行（替代旧的 partialSubmit）
   *
   * 累积 args、重算 commandPaths，form 仍保留、引用计数不变。
   * 对应 refine tool。
   *
   * @returns 更新后的 form 快照；formId 不存在时返回 null
   */
  applyRefine(
    formId: string,
    args: Record<string, unknown>,
  ): ActiveForm | null {
    const form = this.forms.get(formId);
    if (!form) return null;

    /* 累积 args：后者覆盖前者同名字段。生成全新对象（immutability）。 */
    const nextArgs: Record<string, unknown> = { ...form.accumulatedArgs, ...args };
    const nextPaths = deriveCommandPaths(form.command, nextArgs);
    const resolvedPaths = nextPaths.length > 0 ? nextPaths : [form.command];

    const next: ActiveForm = {
      ...form,
      accumulatedArgs: nextArgs,
      commandPaths: resolvedPaths,
    };
    this.forms.set(formId, next);
    return next;
  }

  /** 提交 form，返回被提交的 form 信息（不存在返回 null） */
  submit(formId: string): ActiveForm | null {
    const form = this.forms.get(formId);
    if (!form) return null;
    this.forms.delete(formId);
    const count = (this.commandRefCount.get(form.command) ?? 1) - 1;
    if (count <= 0) {
      this.commandRefCount.delete(form.command);
    } else {
      this.commandRefCount.set(form.command, count);
    }
    return form;
  }

  /** 取消 form，返回被取消的 form 信息（不存在返回 null） */
  cancel(formId: string): ActiveForm | null {
    return this.submit(formId); // 逻辑相同：移除 form + 引用计数 -1
  }

  /**
   * 追加本 form 已加载的 trait（engine 在 begin / applyRefine 后调用）
   *
   * 幂等：重复 id 不再追加。
   */
  addLoadedTraits(formId: string, traitIds: string[]): void {
    const form = this.forms.get(formId);
    if (!form) return;
    const set = new Set(form.loadedTraits);
    for (const id of traitIds) set.add(id);
    this.forms.set(formId, { ...form, loadedTraits: Array.from(set) });
  }

  /** 获取当前活跃的指令类型集合（引用计数 > 0 的） */
  activeCommands(): Set<string> {
    return new Set(this.commandRefCount.keys());
  }

  /**
   * 获取当前所有活跃 form 的 commandPaths 合并集合（Phase 4）
   *
   * 用于精确匹配 trait.activates_on.show_content_when。同一 command 多 form 时扁平化各自的
   * commandPaths 数组；结果去重（Set 保证）。
   */
  activeCommandPaths(): Set<string> {
    const result = new Set<string>();
    for (const form of this.forms.values()) {
      for (const p of form.commandPaths) {
        result.add(p);
      }
    }
    return result;
  }

  /** 获取所有活跃 form 列表 */
  activeForms(): ActiveForm[] {
    return Array.from(this.forms.values());
  }

  /** 获取指定 form */
  getForm(formId: string): ActiveForm | null {
    return this.forms.get(formId) ?? null;
  }

  /** 从持久化数据恢复 */
  static fromData(forms: ActiveForm[]): FormManager {
    const mgr = new FormManager();
    for (const raw of forms) {
      /* 向后兼容：老 form 可能没有 accumulatedArgs / commandPaths / loadedTraits */
      /* 数据格式迁移：老版本存的是 commandPath: string，新版本是 commandPaths: string[] */
      const accumulated = raw.accumulatedArgs ?? {};
      let commandPaths: string[];
      if (Array.isArray((raw as unknown as { commandPaths?: unknown }).commandPaths)) {
        /* 新格式 */
        commandPaths = (raw as unknown as { commandPaths: string[] }).commandPaths;
      } else if (typeof (raw as unknown as { commandPath?: unknown }).commandPath === "string") {
        /* 老格式迁移：单路径 → 数组 */
        commandPaths = [(raw as unknown as { commandPath: string }).commandPath];
      } else {
        /* 无路径信息：重新计算 */
        const derived = deriveCommandPaths(raw.command, accumulated);
        commandPaths = derived.length > 0 ? derived : [raw.command];
      }
      const normalized: ActiveForm = {
        formId: raw.formId,
        command: raw.command,
        description: raw.description,
        createdAt: raw.createdAt,
        trait: raw.trait,
        method: raw.method,
        accumulatedArgs: accumulated,
        commandPaths,
        loadedTraits: Array.isArray(raw.loadedTraits) ? raw.loadedTraits : [],
      };
      mgr.forms.set(normalized.formId, normalized);
      mgr.commandRefCount.set(normalized.command, (mgr.commandRefCount.get(normalized.command) ?? 0) + 1);
    }
    return mgr;
  }

  /** 导出为持久化数据 */
  toData(): ActiveForm[] {
    return Array.from(this.forms.values());
  }
}
