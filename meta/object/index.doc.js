export const object_v20260504_1 = {
  index: `
OOC （Object Oriented Context）由 Object 组成，每个 Object 都有以下特征：
- Object 是一个对象，包含属性和方法 （数据与程序）
- Object 可以被其他 Object 引用，也可以引用其他 Object，可以和其他 Object 交互
- Object 具有知识 (角色知识、技能知识、经验知识、记忆)
- Object 可持久化为文件，并可以进行元编程 (阅读、修改自己)

从组成上（工程实现），Object 的“可被系统读取的实体形态”主要是文件系统目录：

- Stone：\`stones/{name}/\`（长期数据: 长期身份、数据、固化能力、长期记忆）
- Flow：\`flows/{sessionId}/objects/{name}/\`（会话数据: 一次任务中的运行态数据）
`,
};
