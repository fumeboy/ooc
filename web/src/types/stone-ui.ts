/**
 * 对象自渲染 UI 的 Props 类型
 *
 * 对象在 ui/index.tsx 中编写 React 组件，
 * 前端通过 Vite 动态 import 加载，自动热更新。
 */

export interface StoneUIProps {
  /** 对象的静态数据 */
  stone: {
    name: string;
    whoAmI: string;
    data: Record<string, unknown>;
  };
  /** 当前活跃的 flow（如果有） */
  flow?: {
    sessionId: string;
    status: string;
    process: unknown;
    messages: unknown[];
  };
  /** 当前 session ID */
  sessionId?: string;
  /** 向该对象发消息 */
  sendMessage: (msg: string) => void;
}

/** Flow 级别自渲染 UI 的 Props */
export interface FlowUIProps {
  sessionId: string;
  objectName: string;
}
