/**
 * Form 管理器
 *
 * 管理指令生命周期的 form 模型。
 * 每个指令通过 begin/submit/cancel 三阶段执行。
 * 同类型 form 共享 trait 加载（引用计数）。
 *
 * @ref docs/superpowers/specs/2026-04-12-command-lifecycle-progressive-trait-design.md#6
 */

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
  /** call_function 专用：目标 trait */
  trait?: string;
  /** call_function 专用：函数名 */
  functionName?: string;
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
  begin(command: string, description: string, extra?: { trait?: string; functionName?: string }): string {
    const formId = generateFormId();
    this.forms.set(formId, {
      formId, command, description, createdAt: Date.now(),
      ...extra,
    });
    this.commandRefCount.set(command, (this.commandRefCount.get(command) ?? 0) + 1);
    return formId;
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

  /** 获取当前活跃的指令类型集合（引用计数 > 0 的） */
  activeCommands(): Set<string> {
    return new Set(this.commandRefCount.keys());
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
    for (const form of forms) {
      mgr.forms.set(form.formId, form);
      mgr.commandRefCount.set(form.command, (mgr.commandRefCount.get(form.command) ?? 0) + 1);
    }
    return mgr;
  }

  /** 导出为持久化数据 */
  toData(): ActiveForm[] {
    return Array.from(this.forms.values());
  }
}
