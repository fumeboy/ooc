import { object_v20260504_1 } from "@meta";

export const persistable_v20260504_1 = {
    parent: object_v20260504_1,
    index: `
Persistable 描述 Object 如何在文件系统中存在。

存在的两个基本形态:
- stone
    - 静态形态
    - 表示这个 Object 的长期身份、数据、trait、memory
- flow / session
    - 动态形态
    - 表示这个 Object 在某个 session 的运行过程

stone 持久化的核心文件:
/stones/{objectId}/
- .stone.json
    配置文件 & 标识这是一个 stone 目录
- self.md
    对象身份与自我说明
- knowledge
    知识库
- knowledge/.knowledge.json
    知识库配置文件, 比如用于配置对其他文件路径的文件的引用
- knowledge/{dirName}
    知识库目录下允许有多级子目录，只为了便于管理文档，无特别含义
- knowledge/**/*.md
    知识文档，具有 yaml frontmatter 格式头
- knowledge/memory/
    跨任务保留的记忆，目录结构类似于 knowledge
- knowledge/memory/index.md
    记忆索引页 + 最近记忆
- knowledge/relations/
    关系文档
- knowledge/relations/self.md
    向其他对象介绍自己的文档
- knowledge/relations/{objectId}.md
    和其他 Object 的关系文档
- data.json
    Object 所具有的属性、数据
- server/
    Object 所具有的方法程序
- server/index.ts  
    路由注册层，声明哪些函数可以被 LLM "看见"、声明哪些函数可以被前端访问
- client/
    React UI 页面
- client/index.tsx
    首页
- files
    其他文件


flow 持久化的文件:
/flows/{sessionId}/objects/{objectId}/
- .flow.json
    配置文件 & 标识这是一个 flow object 目录
- 除了没有 self.md，复用和上述 stone 一样的目录结构 (stone + flow 的数据共同组合为 session 下的 object 数据)
- threads/
    线程目录
- threads/{threadId}/thread.json
    线程数据
- threads/{threadId}/debug/llm.context.xml
    debug 数据， 默认要产出，构造的 context，每次请求 LLM 前写入该文件
    相关设计可以见 observable 文档
- threads/{threadId}/debug/llm.messages.json
    debug 数据， 默认要产出，构造的 llm messages, 每次请求 LLM 前写入该文件
- threads/{threadId}/debug/llm.output.json
    debug 数据， 默认要产出，LLM 输出内容
- threads/{threadId}/debug/loop.1.context.xml
    debug 数据， 第一轮的 context ，开启 debug 模式后记录每一轮的上述三个 debug 文件
`,
};

