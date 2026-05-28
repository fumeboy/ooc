type DocTreeNode = {
    title: string;
    content?: string;
    named?: Record<string, string>;
    children?: Record<string, DocTreeNode>;
    patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]];
    sources?: [[any, string]];
    todo?: string[];
    warnings?: string[];
};

export const root: DocTreeNode = {
    title: "app.client - Web 控制面",
    content: `
    app.client 是 OOC 的 Web 控制面，基于 vite + React + react-router 实现。

    核心组成:
    1. **AppShell 路由**: ooc:// URI 1:1 映射 SPA route。四类路由统一形式 (详见 spec §5.1)。
    2. **ObjectClientRenderer**: 按原型链 fallback 解析每个 Object 的 client/index.tsx；root 原型必有兜底。
    3. **chat 模型**: 用户视角下浏览的 Object 列表（每个 Object UI 内含 talk 输入框），取代旧的 talk_window 列表模型。
    4. **历史 flow 只读**: 进入 /flows/<old_session>/objects/<id> 不显示 talk 输入框、调用按钮 disabled。
    5. **方法 button 直调**: web 可直接 invoke public 方法（非敏感的）；敏感方法标 requireLLM 拒按钮直调。
    `,
    named: {
        "AppShell": "顶层路由 + 全局布局组件",
        "ObjectClientRenderer": "每个 Object UI 的渲染器；走原型链 fallback",
        "chat 模型": "用户视角的 Object 浏览列表（替代旧 talk_window 列表）",
        "原型链 fallback": "Object 自身无 client → 沿 extends 链向上 → 落 root.client 兜底",
        "requireLLM": "敏感方法标记；拒 web 按钮直调，必须经 LLM talk",
    },
    children: {},
    patches: {},
    todo: [
        "todo: AppShell 四类路由已实现基础骨架；pool 路由 (/pools/*) 尚未上线",
        "todo: ObjectClientRenderer 规划阶段——原型链 fallback resolver 未实现，当前用 root.client 统一兜底",
        "todo: chat 模型 cross-object talk_window 为 UI 层规划，后端 /api/talk 已落地",
    ],
};
