type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "engineering.harness - 工程组织结构",
    content: `
    OOC 项目的工程协作模型: 1 Supervisor + 9 Agent (8 AgentOfX 维度对应 + 1 AgentOfExperience 体验官)。

    所有 Agent 都是 stones/<branch>/objects/agent_of_<X>/ 下的 persistent OOC Object（充当 Agent 角色）；Supervisor 在 harness 实现中是 world 级 root parent，符号化角色（不实体化为 Object 目录）。

    interim runtime: 当前由 Claude Code 主会话承担 Supervisor 职责；sub agent dispatch 承接各 AgentOfX 角色。等 ooc-3 P9 阶段会实际落地 9 个 Agent 的 stone 目录。
    `,
    named: {
        "Supervisor": "world 级 root parent；符号化角色",
        "AgentOfX": "对应 8 维度 + experience 共 9 个 persistent Object，扮演该维度的设计与实现 owner",
        "AgentOfExperience": "体验官；负责真实跑功能、发现 Issue、回流给对应 AgentOfX",
        "interim runtime": "当前由 Claude Code 主会话扮 Supervisor，sub agent 扮 AgentOfX",
    },
    children: {},
    patches: {},
    todo: [
        "P9: 在 stones/main/objects/ 下落地 8 个 agent_of_<X>/ + 1 个 agent_of_experience/",
    ],
};
