type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "case - 哨兵平台因子开发助手",
    content: `
    第一个外部场景 case: 把哨兵平台的因子开发助手（plugins_with_agent 项目，15 个 Claude Code SKILL.md）收编成:

    - 3 个持久 OOC Object（充当 Agent 角色）: sentry_factor_dev (流程编排) / sentry_event_factor / sentry_factor_group
    - 1 个 branch 级 skill: psm-query

    展示外部场景如何用 OOC Object + skill 的层次表达。

    待 ooc-3 P9 实施时落到 stones/main/objects/ 下。
    `,
    children: {},
    todo: [
        "P9: 落地 3 个 Object + 1 个 skill",
    ],
};
