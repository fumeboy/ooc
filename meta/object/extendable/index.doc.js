import { object_v20260504_1 } from "@meta";
import { kernel_extensions_v20260506_1 } from "@meta/object/extendable/kernel-extensions.doc";

export const extendable_v20260504_1 = {
    parent: object_v20260504_1,
    index: `
Extendable 描述 Object 如何扩展自己的认知与能力。

Object 的能力来自三种内容：
- **knowledge**  ── 知识文档（markdown + frontmatter，通过 activates_on 渐进式激活）
- **server**     ── 后端方法（TypeScript 函数，分 llm_methods / ui_methods 两通道）
- **client**     ── 前端 React UI 组件

这三类内容可以来自三个**层叠的来源**：

\`\`\`
kernel/        系统内置（namespace = kernel）
   ↓
library/       公共资源库（namespace = library）
   ↓
stones/{name}/  Object 自己的（namespace = self）
\`\`\`

后者覆盖同 namespace:name 的前者（同 namespace 不同来源极少冲突，因为
namespace 由物理位置或 frontmatter 强制声明）。

## 唯一标识

每个 knowledge 文档或 server 模块都有形如 \`{namespace}:{name}\` 的 ID：

| 示例 | 含义 |
|---|---|
| \`kernel:base\`            | kernel 命名空间下的 base knowledge |
| \`kernel:computable\`      | kernel 命名空间下的 computable knowledge |
| \`kernel:computable/file_ops\` | computable 的子 knowledge（name 含 \`/\` 表父子） |
| \`library:lark-doc\`       | library 命名空间下的 lark-doc 扩展 |
| \`self:reporter\`          | Object 自己的 reporter knowledge |

省略 namespace 时（如 deps、callMethod 入口处），按 self → kernel → library 顺序解析。

## 物理组织

### kernel 与 self：平铺三件套

\`\`\`
kernel/                              （或 stones/{name}/，结构相同）
├── knowledge/
│   ├── base.md
│   ├── computable.md
│   ├── computable/                  （name 含 / 的子目录）
│   │   ├── file_ops.md
│   │   └── shell_exec.md
│   └── ...
├── server/
│   ├── computable/
│   │   └── index.ts                 （export llm_methods / ui_methods）
│   ├── library_index/
│   │   └── index.ts
│   └── ...
└── client/
    └── ...                          （React 组件，不进入 LLM context）
\`\`\`

knowledge / server / client 三个目录互不嵌套，按 name 关联——
\`kernel/knowledge/computable.md\` 与 \`kernel/server/computable/index.ts\`
通过共享的 \`kernel:computable\` 这个 ID 自然配对。

### library：打包模式

每个 library 扩展是一个独立的目录，三件套打包在一起：

\`\`\`
library/
├── lark-doc/
│   ├── knowledge.md             （单一 knowledge 文档）
│   └── index.ts                 （server 方法）
├── git/
│   ├── knowledge.md
│   └── index.ts
└── ...
\`\`\`

每个 library 扩展 = 一个目录 = 一个 namespace:library, name=extensionName 的扩展。
client 部分可选（如有，同目录加 \`client.tsx\`）。

为什么 library 用打包模式：library 扩展通常是"一组紧密耦合的知识+方法"，
打包让"安装一个 library 扩展"等于复制一个目录，便于分发。
kernel/self 平铺则因为它们的内容更松散，一个 namespace 下可能有几十篇 knowledge
和几十个 server 模块，平铺更便于管理。

## knowledge：渐进式激活

knowledge 通过 frontmatter 的 \`activates_on\` 控制何时进入 Context：

\`\`\`yaml
---
namespace: kernel
name: computable
description: 代码执行能力（program 指令）
activates_on:
  show_description_when: [program]   # 命中时仅注入 description
  show_content_when:     [program]   # 命中时注入完整正文
---
\`\`\`

详见 thinkable/knowledge。

### 子 knowledge 默认展示 description

当一个 knowledge 被激活，它的所有子 knowledge（同 namespace 下 name 以本 name + "/" 开头的）
默认以 description 的形式注入 Context——让 LLM 知道"还可以进一步 open 哪些细节"。

例：\`kernel:computable\` 激活时，\`kernel:computable/file_ops\` 与 \`kernel:computable/shell_exec\`
的描述会一行注入；LLM 显式 \`open(type=knowledge, name="kernel:computable/file_ops", ...)\`
才注入完整正文。

### pinned 与自动卸载

knowledge 有两种激活路径，回收行为不同：

| 激活方式 | 触发 | 回收 |
|---|---|---|
| **command 驱动** | open(type=command, ...) 触发 activates_on.show_content_when | 该 form submit/close 时若没有其他 form 仍命中，自动 deactivate |
| **手动 pin** | open(type=knowledge, name=...) 显式激活 | 不随 form 关闭，需 close(type=knowledge, name=...) 显式 unpin |

线程节点维护两个独立列表：
- \`activatedKnowledge\` — 当前激活的 knowledge id
- \`pinnedKnowledge\`    — 已"钉住"的 knowledge id，submit/close 回收时豁免

## server：始终注册，但靠 knowledge 引出

server 方法在 Object 加载时**全部注册**到 MethodRegistry，不参与激活管理。

但 LLM **不知道**这些方法存在——除非相关 knowledge 文档（同 namespace:name 或父级）
在 Context 中描述了它们。

\`\`\`
kernel/server/computable/index.ts
  export const llm_methods = { readFile, writeFile, ... }
        ↓
注册到 MethodRegistry：(kernel:computable, readFile, llm) → fn
        ↓
但 LLM 看不到，直到：
  kernel/knowledge/computable.md 在 Context 中（描述了 readFile 等）
        ↓
LLM 通过 callMethod("kernel:computable", "readFile", { path }) 调用
        ↓
sandbox 在 MethodRegistry 中查到，调用 fn
\`\`\`

设计意图：
- **server 始终可调用** → 沙箱实现极简，不需要"按当前激活集动态构建可见方法表"
- **可见性由 knowledge 控制** → 自然复用 knowledge 渐进式激活的容量管理；不需要额外的 server method 注册/卸载逻辑

### 双通道：llm_methods vs ui_methods

server 模块的 \`index.ts\` 可导出两张方法表，严格隔离：

| 通道 | 来源 | 调用入口 |
|---|---|---|
| llm  | \`export const llm_methods\` | sandbox 中 \`callMethod(id, name, args)\` |
| ui   | \`export const ui_methods\`  | HTTP \`POST /api/flows/:sid/objects/:name/call_method\` |

- LLM 通道：所有方法都注册，但可见性靠 knowledge 控制
- UI 通道：HTTP 端点严格白名单——id 必须为 \`self:\` 命名空间、必须命中 ui_methods、且发起调用的 client 视图属于本 Object

详见 executable/server。

## client：不进入 LLM context

client 是 Object 的 React UI 组件，给人看不给 LLM 看。

详见 executable/client。

## library 的特殊性

library namespace 下的 server methods **默认全部注册并对 LLM 可见入口可调**——
和 kernel/self 一样。但 LLM 知不知道这些 method 存在，仍由 library 扩展自己的
knowledge.md 是否在 Context 中决定。

这意味着：用户安装一个 library 扩展，其方法立即"挂入" sandbox（不需要 Object 主动声明），
但要让 Object 真正用起来，仍需在某个 command 路径上 activates_on 触发对应 knowledge。

## 运行时 hook：defer

knowledge 与 server 都没有静态 hook 声明。
唯一的 hook 机制是运行时的 \`defer\` command——LLM 通过
\`open(type=command, command=defer, ...)\` 注册"在某个 command 被 submit 时
向 Context 注入一段提醒文本"。

defer 仅支持 hook command 事件，不支持其他事件类型。
详见 executable/actions/commands/defer。

## knowledge 之间没有静态依赖

knowledge 不能声明依赖其他 knowledge 自动激活——
若一个任务需要多个 knowledge，由 LLM 自行 \`open(type=knowledge, ...)\`，
或在 \`do(fork)\` 创建子线程时通过 \`knowledge\` 参数显式声明。
`,
    kernel_extensions: kernel_extensions_v20260506_1,
};
