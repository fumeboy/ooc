type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "case - 飞书集成（extendable 首个 case）",
    content: `
    extendable 维度（非 8 维度内）的首个 case: 把飞书外部协作能力按统一模板接入。

    设计模式: 创建几个特殊原型 Object 如 feishu_doc / feishu_message，extends: root，方法集封装飞书 API。

    详见 extendable 的定义（meta/object.doc.ts root.children.extendable）。
    `,
    children: {},
    todo: [
        "实现 src/extendable/feishu/ 适配层",
        "创建 stones/_builtin/objects/feishu_*/ 内置原型（或放 branch 而非 builtin？决策留 P6 阶段）",
    ],
};
