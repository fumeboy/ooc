/**
 * ViewRegistry — Editor Tab Content 的组件注册表
 *
 * 统一管理文件路径到视图组件的映射。
 * 每个注册项定义：匹配规则、优先级、tab 合并逻辑、组件。
 */
import type { ComponentType } from "react";

/** 所有 Editor Tab Content 组件的统一 props */
export interface ViewProps {
  path: string;
}

/** 视图注册项 */
export interface ViewRegistration {
  /** 注册名（调试用） */
  name: string;
  /** 组件 */
  component: ComponentType<ViewProps>;
  /** 路径匹配函数 — 判断该 path 是否由此组件处理 */
  match: (path: string) => boolean;
  /** 优先级 — 数字越大越优先匹配 */
  priority: number;
  /** Tab 索引函数 — 从 path 提取 tab key，相同 key 复用同一个 editor tab */
  tabKey: (path: string) => string;
  /** Tab 标签函数 — 从 path 提取显示名称 */
  tabLabel: (path: string) => string;
}

/** 匹配结果 */
export interface MatchResult {
  registration: ViewRegistration;
  tabKey: string;
  tabLabel: string;
}

class ViewRegistryImpl {
  private _registrations: ViewRegistration[] = [];

  /** 注册一个视图组件 */
  register(reg: ViewRegistration): void {
    this._registrations.push(reg);
    /* 按优先级降序排列，高优先级先匹配 */
    this._registrations.sort((a, b) => b.priority - a.priority);
  }

  /** 根据 path 查找匹配的注册项 */
  resolve(path: string): MatchResult | null {
    for (const reg of this._registrations) {
      if (reg.match(path)) {
        return {
          registration: reg,
          tabKey: reg.tabKey(path),
          tabLabel: reg.tabLabel(path),
        };
      }
    }
    return null;
  }

  /** 获取所有注册项（调试用） */
  getAll(): readonly ViewRegistration[] {
    return this._registrations;
  }
}

/** 全局单例 */
export const viewRegistry = new ViewRegistryImpl();
