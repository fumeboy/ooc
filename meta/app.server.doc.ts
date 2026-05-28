// 文档维护说明同 meta/object.doc.ts（精简）

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
    title: "app.server - HTTP 控制面",
    content: `
    app.server 是 OOC 的 HTTP 控制面 + worker 调度面，基于 Elysia 实现。

    核心组成:
    1. **三层 Object loader** (详见 children.loader): 扫 stone (_builtin + branch) / pool (per-Object + shared) / flow (current active)，建 ObjectRecord registry，按 prototype 链解析方法与 client UI。
    2. **HTTP 路由**: ooc:// URI 1:1 镜像，统一形式 \`/stones/<branch>/objects/<name>\` / \`/pools/objects/<name>\` / \`/pools/<shared>\` / \`/flows/<sessionId>/objects/<name>\`。
    3. **worker queue**: 主 thread + sub-thread 的 LLM 调用调度；按 sessionId / objectId / thread_id 三元定位。
    4. **talk 直投回路**: A.talk(B) 在 flow 层 append 双端 talks/ 文件 + 调度 B 的 worker wake。
    5. **ephemeral Object 创建**: 由 root 原型的 grep / glob / open_file / open_knowledge / program 等方法触发 flows/<sessionId>/objects/<id>/ 落盘。
    `,
    named: {
        "Elysia": "TypeScript HTTP 框架；OOC 控制面基础",
        "三层 loader": "扫 stone / pool / flow 的统一加载器",
        "ObjectRecord": "Object 的运行时表示；含 stone/pool/flow 三层 paths",
        "worker queue": "LLM 调用调度队列",
    },
    children: {},
    patches: {},
    todo: [
        "loader: 实现三层源扫描 + extends 解析 + 循环检测 (P3)",
        "worker: 实现 talk 直投 + sub-thread spawn (P5)",
        "ephemeral 创建: 实现 grep / program / search 等方法的落盘机制 (P6)",
    ],
};
