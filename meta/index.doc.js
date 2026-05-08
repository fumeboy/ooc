import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import { extendable_v20260504_1 } from "@meta/object/extendable/index.doc";
import { observable_v20260504_1 } from "@meta/object/observable/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";

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

其中“程序”以 **server/client** 的方式存在于目录树中：
- server：后端方法（TypeScript，export llm_methods 用于供 LLM 调用 / export ui_methods 供前端调用）
- client：前端界面（React）
结构细节见 persistable 与 extendable。

分为以下几个维度:
- thinkable
    - 对象如何构造 Context，如何在 Thread 中思考
- collaborable
    - 对象如何 talk、协作与形成关系网络
- executable
    - 对象如何通过 tools、forms、commands 采取行动
- persistable
    - 对象如何通过文件系统以 stone、flow、session、threads、memory 的形式持续存在
- extendable
    - 对象如何扩展自己的认知与能力
- observable
    - 对象如何被记录、检查、调试、验证和理解
- reflectable
    - 对象如何进行自我迭代、元编程
`,
  thinkable: thinkable_v20260504_1,
  collaborable: collaborable_v20260504_1,
  executable: executable_v20260504_1,
  persistable: persistable_v20260504_1,
  extendable: extendable_v20260504_1,
  observable: observable_v20260504_1,
  reflectable: reflectable_v20260504_1,
};

export const meta_v20260506_1 = {
  index: `
kernel/meta 是 OOC 的元文档入口。

- object：系统是什么（按能力维度）
- engineering：我们如何做（实践侧元循环）
`,
  object: object_v20260504_1,
  engineering: engineering_v20260506_1,
};
