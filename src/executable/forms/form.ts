/**
 * Form 管理器
 *
 * 管理指令生命周期的 form 模型，方法名与对应的 LLM tool 一一对应：
 * - open：创建 form，加载相关 knowledge（open tool 触发）
 * - refine：累积 args 但不执行；重算命令路径（refine tool 触发）
 * - submit：按最终 args 执行指令，form 结束（submit tool 触发）
 * - close：放弃执行，form 结束（close tool 触发；逻辑等价 submit，但不触发指令）
 *
 * 同类型 form 共享 command 级别的激活状态（引用计数）。
 */

import { deriveCommandPaths } from "../commands/index.js";

/** 活跃的 Form */
export interface ActiveForm {
  /** Form 唯一标识 */
  formId: string;
  /** 指令类型（如 "talk", "program"） */
  command: string;
  /** 描述（open 时提供） */
  description: string;
  /** 创建时间戳 */
  createdAt: number;
  /**
   * 累积的 args（渐进式填表）
   *
   * refine 把本次 args 与现有累积合并（后者覆盖前者同名字段）；
   * 最终 submit 时把累积 args 交付给指令执行器。
   * 未经 refine 的 form 保持 `{}`。
   */
  accumulatedArgs: Record<string, unknown>;

  /**
   * 当前激活的 path 集合（由 deriveCommandPaths(command, accumulatedArgs) 算出）
   *
   * open 时 = match(command, {})；refine 后用最新累积 args 重算。
   * Context 构建阶段会基于这些 path 决定激活哪些 knowledge。
   * 多路径并行：如 ["talk", "talk.continue", "talk.relation_update"]。
   */
  commandPaths: string[];

  /**
   * 本 form 已加载的 knowledge path 列表
   *
   * 用于 submit / close 时批量释放——避免因渐进填表
   * 触发的临时 knowledge 在 form 结束后仍残留 context。
   * open 时由 engine 写入初始加载集；refine 新增追加；关闭时参考此字段。
   */
  loadedKnowledgePaths: string[];

  /**
   * Form 生命周期状态。
   * - open：刚 open，未 submit；可以被 refine
   * - executing：submit 已触发但 command 未返回；不可 refine 不可二次 submit
   * - executed：command 已返回，结果在 result 字段；LLM 看完后用 close 释放
   */
  status: "open" | "executing" | "executed";

  /** command 执行返回的结果文本；目前只有 program.shell 真正写入。 */
  result?: string;

  /**
   * 当 form.command === "program" 且 accumulatedArgs.function 命中已注册 server 方法时，
   * 由 enrichProgramForm 自动从 stone 的 server/index.ts 抓取该方法的 description + params 快照。
   * 渲染到 active_forms 的 <method_schema> 段，让 LLM 在 refine 之前看到方法签名。
   */
  methodSchema?: {
    description?: string;
    params?: Array<{
      name: string;
      type?: string;
      description?: string;
      required?: boolean;
    }>;
  };
}

/** 生成 form_id */
function generateFormId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Form 管理器 */
export class FormManager {
  private forms = new Map<string, ActiveForm>();
  private commandRefCount = new Map<string, number>();

  /** 开启 form，返回 form_id（对应 open tool）。 */
  open(command: string, description: string): string {
    const formId = generateFormId();
    this.forms.set(formId, {
      formId,
      command,
      description,
      createdAt: Date.now(),
      accumulatedArgs: {},
      commandPaths: deriveCommandPaths(command, {}).length > 0 ? deriveCommandPaths(command, {}) : [command],
      loadedKnowledgePaths: [],
      status: "open",
    });
    this.commandRefCount.set(command, (this.commandRefCount.get(command) ?? 0) + 1);
    return formId;
  }

  /**
   * 累积 args 但不执行（对应 refine tool）。
   *
   * 累积 args、重算 commandPaths，form 仍保留、引用计数不变。
   *
   * @returns 更新后的 form 快照；formId 不存在时返回 null
   */
  refine(
    formId: string,
    args: Record<string, unknown>,
  ): ActiveForm | null {
    const form = this.forms.get(formId);
    if (!form) return null;
    if (form.status !== "open") return null;

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

  /** 提交 form，把 status 从 open 切到 executing，返回 form 快照（不删除）。 */
  submit(formId: string): ActiveForm | null {
    const form = this.forms.get(formId);
    if (!form) return null;
    if (form.status !== "open") return null;
    const next: ActiveForm = { ...form, status: "executing" };
    this.forms.set(formId, next);
    return next;
  }

  /** 把 form 从 executing 切到 executed 并写入 result（command 完成后由 handler 调用）。 */
  markExecuted(formId: string, result?: string): ActiveForm | null {
    const form = this.forms.get(formId);
    if (!form) return null;
    if (form.status !== "executing") return null;
    const next: ActiveForm = { ...form, status: "executed", result };
    this.forms.set(formId, next);
    return next;
  }

  /** 关闭 form，无论状态都从表中移除，返回被关闭的 form 信息（不存在返回 null）。 */
  close(formId: string): ActiveForm | null {
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

  /**
   * 追加本 form 已加载的 knowledge path（engine 在 open / refine 后调用）
   *
   * 幂等：重复 id 不再追加。
   */
  addLoadedKnowledgePaths(formId: string, knowledgePaths: string[]): void {
    const form = this.forms.get(formId);
    if (!form) return;
    const set = new Set(form.loadedKnowledgePaths);
    for (const path of knowledgePaths) set.add(path);
    this.forms.set(formId, { ...form, loadedKnowledgePaths: Array.from(set) });
  }

  /** 获取当前活跃的指令类型集合（引用计数 > 0 的） */
  activeCommands(): Set<string> {
    return new Set(this.commandRefCount.keys());
  }

  /**
   * 获取当前所有活跃 form 的 commandPaths 合并集合
   *
   * 用于精确匹配 command path 对应的 knowledge 激活条件。同一 command 多 form 时扁平化各自的
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
    for (const raw of forms as Array<ActiveForm & {
      commandPath?: string;
      loadedTraits?: string[];
      trait?: string;
      method?: string;
    }>) {
      /* 向后兼容：老 form 可能没有 accumulatedArgs / commandPaths / loadedKnowledgePaths */
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
      /* 兼容旧字段 loadedTraits，并在恢复时彻底抹掉 trait/method 等废弃概念。 */
      const loadedKnowledgePaths = Array.isArray(raw.loadedKnowledgePaths)
        ? raw.loadedKnowledgePaths
        : Array.isArray(raw.loadedTraits)
          ? raw.loadedTraits
          : [];
      const normalized: ActiveForm = {
        formId: raw.formId,
        command: raw.command,
        description: raw.description,
        createdAt: raw.createdAt,
        accumulatedArgs: accumulated,
        commandPaths,
        loadedKnowledgePaths,
        status: raw.status ?? "open",
        result: raw.result,
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
