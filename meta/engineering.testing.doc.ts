type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "engineering.testing - 测试策略",
    content: `
    OOC 测试三档评分 + 双观察孔:

    1. **三档评分**: Good / OK / Bad，按 spec 测试场景的明确 Good 标准评估。
    2. **A 观察孔 backend**: Elysia app.handle() 直调，覆盖 HTTP + worker 端到端 (route-audit gate 必过)。
    3. **B 观察孔 frontend**: Playwright 真浏览器，覆盖 SPA route + AppShell + ObjectClientRenderer。

    必加 e2e 场景（详见 spec §7.2 + §7.3）含: prototype chain resolve / public-private 边界 / stone/pool/flow 写入归位 / ephemeral 落盘 / 自动 flow 创建 / talk 直投回路 / sub-thread 扁平 + 共享身份 / super flow 升格 / B 类塌缩字段 / route-audit / active_branch 隔离。

    7 条 merge gate (详见 spec §7.4):
    1. route-audit 全员通过
    2. prototype chain resolve 单元测试 100% 覆盖
    3. stone/pool/flow 写入归位 e2e PASS
    4. talk / do 直投回路 e2e PASS 在真浏览器
    5. ephemeral 落盘 fs assertion
    6. super flow 升格回路 e2e PASS
    7. tsc --noEmit meta/*.doc.ts 全员通过
    `,
    named: {
        "三档评分": "Good / OK / Bad 三档评判",
        "双观察孔": "A 孔 backend / B 孔 frontend",
        "route-audit": "扫描所有 public method 是否有真 HTTP 路由注册的 gate",
    },
    children: {},
    patches: {},
    todo: [
        "P5/P6/P7: 实现 §7.2 + §7.3 的 e2e 场景",
        "merge gate: P10 收尾终检 7 条 gate",
    ],
};
