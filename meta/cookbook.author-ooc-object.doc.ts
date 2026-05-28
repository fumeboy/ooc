type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "cookbook - 添加新 OOC Object 教学",
    content: `
    从空到能跑的 5 步教学（取代旧 ooc-2 中 add-new-agent + author-ooc-agent 两份）:

    1. **选 prototype**: 从 stones/_builtin/objects/ 下 8 个内置原型选一个继承（最常用 \`extends: root\`）；或继承 branch 内已有 Object。
    2. **创建 stone 目录**: \`stones/<branch>/objects/<name>/\` 或 \`stones/<branch>/objects/<parent>/children/<name>/\`。
    3. **写 self.md + readme.md**: frontmatter 含 \`extends:\`；body 写身份与角色。
    4. **写 server/index.ts**: 显式导出 \`{ public: {...}, private: {...} }\`；可只写 \`public: {}\` 完全继承 prototype 方法。
    5. **(可选) 写 client/index.tsx**: 自定义 UI；缺则原型链 fallback 到 root 兜底。

    验证: 启动 server → 通过 /stones/<branch>/objects/<name> 路由能看到 UI → talk 一句话能唤起 LLM 思考。
    `,
    named: {
        "5 步教学": "选 prototype → 建 stone 目录 → self/readme → server → (可选) client",
        "extends": "self.md frontmatter 字段；声明 prototype 父节点",
    },
    children: {},
    patches: {},
    todo: [
        "P9: 写出详细 cookbook 含具体示例 (3 个 builtin 原型继承 / 1 个 branch 内继承)",
    ],
};
