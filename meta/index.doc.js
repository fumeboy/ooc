import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import { extendable_v20260504_1 } from "@meta/object/extendable/index.doc";
import { observable_v20260504_1 } from "@meta/object/observable/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";

export const object_v20260504_1 = {
    index: `
OOC （Object Oriented Context）由 Object 组成，每个 Object 都有以下特征：
- Object 是一个对象，包含属性和方法 （数据与程序）
- Object 可以被其他 Object 引用，也可以引用其他 Object，可以和其他 Object 交互
- Object 具有知识 (角色知识、技能知识、经验知识、记忆)
- Object 可持久化为文件，并可以进行元编程 (阅读、修改自己)

从组成上，Object 具有
- 知识库
- 前端程序
- 服务端程序
- 数据库

分为以下几个维度:
- thinkable
    - 对象如何构造 Context，如何在 Thread 中思考
- collaborable
    - 对象如何 talk、return、协作与形成关系网络
- executable
    - 对象如何通过 tools、forms、commands 采取行动
- persistable
    - 对象如何以 stone、flow、memory、effects 的形式持续存在
- extendable
    - 对象如何通过 trait、skill、view 扩展自己的认知与能力
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
}
