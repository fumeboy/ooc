# Thinkable LLM Client Design

日期：`2026-05-08`

## 背景

当前仓库正在进行 OOC 系统重构，第一批次优先迁移核心且复杂度较低的能力。

本次要落地的能力位于 `thinkable` 维度，对应 ThinkLoop 中的 `context-build -> llm -> tool-use -> 循环` 里的 `llm` 环节。

当前仓库已有：

- 元文档入口：`meta/index.doc.js`
- `thinkable` 文档入口：`meta/object/thinkable/index.doc.js`
- 运行时环境变量文件：`.env`

当前仓库还没有 Bun 项目骨架，也没有 `src/` 目录，因此本次工作需要同时完成：

1. 初始化最小 Bun + TypeScript 工程骨架
2. 在 `src/thinkable/llm/` 下实现统一 LLM client
3. 支持 OpenAI 协议与 Claude 协议
4. 支持流式输出
5. 支持从统一的 `OOC_*` 环境变量读取默认配置

## 目标

本次设计只解决以下问题：

- 建立最小 Bun 工程，使后续 `thinkable` 源码可以持续扩展
- 提供统一的 LLM client 门面，屏蔽 OpenAI / Claude 协议差异
- 提供文本生成与流式文本输出能力
- 保持实现边界清晰，避免为未来可能需求提前抽象

## 非目标

本次设计明确不包含以下内容：

- tools / function calling
- multimodal
- reasoning 字段抽象
- usage 统一抽象
- 自动按 model 推断 provider
- provider 专属环境变量覆盖层
- thinkloop / context-builder / engine 集成
- CLI、HTTP server、watch mode、发布配置
- 大规模兼容层和通用 SDK 包装层

## 用户确认的约束

### 运行时与接口约束

- 对外暴露统一 client，而不是分裂成多个上层接口
- provider 默认从环境变量读取
- 流式输出采用 `AsyncIterable`
- 首批只支持文本请求与文本流输出

### 代码质量约束

- 源代码必须使用中文注释
- 注释密度不低于每 5 行代码 1 行注释
- 避免过早抽象
- 不做防御性编程，保持逻辑干净、直接

### 文档约束

- 源代码与 `doc.js` 元文档之间必须建立引用关系
- 如果实现需要新增当前文档树中尚未显式存在的概念，补文档前必须再次征求用户确认

## 设计原则

### 1. 统一门面，分离协议适配

上层只看到一套 `LlmClient` 接口，内部通过 provider adapter 处理 OpenAI 与 Claude 的协议差异。

这样做的原因是：

- 上层 `thinkloop` 不需要知道底层协议差异
- 第一批次就能建立稳定边界
- 后续扩展新 provider 时只需要新增适配器

### 2. 单一配置模型

第一批只支持统一的 `OOC_*` 环境变量，不做 provider 专属环境变量覆盖层。

这样做的原因是：

- 当前目标是先建立最小核心闭环
- 多层配置会显著增加认知复杂度
- 当前没有真实需求证明必须支持一进程多套 provider 配置

### 3. 先最小文本闭环，再扩展能力

本次只支持：

- 文本 messages 输入
- 非流式文本输出
- 流式文本增量输出

tools、reasoning、usage 等能力全部延后，避免第一批实现被高级特性拖复杂。

### 4. 统一流事件模型

不论底层是 OpenAI SSE 还是 Claude streaming，最终都归一化为同一种 `AsyncIterable` 事件流。

这样上层只消费一种事件格式，不需要散落 provider 分支判断。

### 5. 错误直接抛出，不伪装成正常事件

流式接口失败时直接抛异常终止迭代，不引入 `error` 事件。

这样做更直接，也更符合后续 ThinkLoop 层的错误处理方式：由上层 `catch` 后决定是否注入错误信息或标记线程失败。

## 目录设计

首批实现后，项目最小结构如下：

```txt
.
├── package.json
├── tsconfig.json
├── src/
│   └── thinkable/
│       └── llm/
│           ├── index.ts
│           ├── types.ts
│           ├── env.ts
│           ├── client.ts
│           └── providers/
│               ├── openai.ts
│               └── claude.ts
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-08-thinkable-llm-client-design.md
```

## 配置设计

### 环境变量

第一批只支持以下统一环境变量：

```env
OOC_PROVIDER=openai
OOC_API_KEY=...
OOC_BASE_URL=...
OOC_MODEL=...
```

字段含义：

- `OOC_PROVIDER`：协议类型，允许值为 `openai` 或 `claude`
- `OOC_API_KEY`：当前 provider 使用的 API Key
- `OOC_BASE_URL`：当前 provider 的服务地址
- `OOC_MODEL`：默认模型名

### 配置优先级

配置优先级只保留两层：

1. 调用参数显式传入
2. `OOC_*` 环境变量

不做任何 provider 专属覆盖逻辑。

## 核心接口设计

### Provider 类型

```ts
type LlmProvider = "openai" | "claude";
```

### 统一消息结构

```ts
type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
```

说明：

- 第一批只支持纯文本消息
- 不引入复杂 content block
- 不对 system message 做单独字段抽象，统一走 `messages`

### 请求参数

```ts
type LlmGenerateParams = {
  provider?: LlmProvider;
  model?: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
};
```

### 非流式结果

```ts
type LlmGenerateResult = {
  provider: LlmProvider;
  model: string;
  text: string;
  raw?: unknown;
};
```

### 流式事件

```ts
type LlmStreamEvent =
  | { type: "start"; provider: LlmProvider; model: string }
  | { type: "text-delta"; text: string }
  | { type: "done"; text: string; raw?: unknown };
```

### 客户端接口

```ts
interface LlmClient {
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
  stream(params: LlmGenerateParams): AsyncIterable<LlmStreamEvent>;
}
```

## 模块职责

### `src/thinkable/llm/types.ts`

职责：

- 统一定义所有公共类型
- 保持 provider adapter 与上层接口的契约清晰

边界：

- 不放实现逻辑
- 不放环境变量解析逻辑

### `src/thinkable/llm/env.ts`

职责：

- 从运行时读取 `OOC_*` 环境变量
- 完成最小配置校验
- 输出标准化配置对象

边界：

- 不发 HTTP 请求
- 不负责 provider 协议细节

### `src/thinkable/llm/providers/openai.ts`

职责：

- 负责 OpenAI 协议的非流式与流式请求
- 把 OpenAI 响应转换为统一结果或统一流事件

边界：

- 只处理 OpenAI 协议
- 不负责选择 provider

### `src/thinkable/llm/providers/claude.ts`

职责：

- 负责 Claude 协议的非流式与流式请求
- 把 Claude 响应转换为统一结果或统一流事件

边界：

- 只处理 Claude 协议
- 不负责选择 provider

### `src/thinkable/llm/client.ts`

职责：

- 提供统一 `createLlmClient()` 工厂
- 根据参数或环境变量选择 provider adapter
- 对外暴露统一 `generate()` 与 `stream()`

边界：

- 不承担上层业务逻辑
- 不承担 thinkloop 的 pause / debug / tool orchestration

### `src/thinkable/llm/index.ts`

职责：

- 统一导出公共 API

边界：

- 不引入额外逻辑

## 协议映射设计

### OpenAI 协议

首批采用 `/chat/completions` 路径，支持：

- `stream: false`
- `stream: true`

提取规则：

- 非流式：从最终 assistant message 中提取文本
- 流式：从 delta content 中提取文本增量

### Claude 协议

首批采用 `/v1/messages` 路径，支持：

- `stream: false`
- `stream: true`

提取规则：

- 非流式：从响应 content 中拼接文本
- 流式：从增量事件中提取文本片段

### 统一策略

两个 provider 最终都只输出：

- provider
- model
- text
- raw

和统一流事件：

- `start`
- `text-delta`
- `done`

## 数据流设计

### 非流式路径

```txt
generate(params)
  -> 解析配置
  -> 选择 provider adapter
  -> 发起 provider 请求
  -> 解析最终文本
  -> 返回统一结果
```

### 流式路径

```txt
stream(params)
  -> 解析配置
  -> 选择 provider adapter
  -> 建立流式请求
  -> 先产出 start
  -> 持续产出 text-delta
  -> 聚合最终文本
  -> 产出 done
```

### 统一实现策略

为了减少重复实现，`generate()` 可以内部复用 `stream()` 的聚合逻辑，形成单一结果生成路径。

## 错误处理设计

### 配置错误

包括：

- 缺少 `OOC_API_KEY`
- 缺少 `OOC_MODEL`
- 缺少 `OOC_BASE_URL`
- `OOC_PROVIDER` 非法

策略：

- 在请求发出前直接抛错

### HTTP / 协议错误

包括：

- 非 2xx 状态码
- 响应体不是预期结构
- 上游返回格式不符合所选 provider 协议

策略：

- 统一抛出明确错误
- 错误消息应包含 provider 与关键状态信息

### 流式解析错误

包括：

- SSE 中断
- chunk 解析失败
- Claude 流事件结构不符合预期

策略：

- 直接抛异常终止迭代
- 不引入 `error` 事件类型

## 测试策略

首批测试遵循“高价值、低噪音”原则。

### 应包含的测试

1. 配置解析测试
   - 正常读取 `OOC_*` 环境变量
   - 缺少关键字段时抛错
   - 非法 provider 时抛错

2. provider 选择测试
   - 默认走环境变量指定 provider
   - 调用参数可覆盖默认 provider

3. OpenAI 适配测试
   - 非流式文本正确提取
   - 流式 chunk 正确归一化为统一事件

4. Claude 适配测试
   - 非流式文本正确提取
   - 流式事件正确归一化为统一事件

5. 统一 client 测试
   - `generate()` 能返回聚合后的最终文本
   - `stream()` 事件顺序正确
   - `generate()` 与 `stream()` 的最终文本一致

### 不建议做的测试

- 真连接外部服务的集成测试
- 大量 snapshot 测试
- 对底层原始 chunk 格式做脆弱断言

### 建议的测试方式

- 使用 mock `fetch`
- 断言统一输出结果，而不是过度绑定底层响应细节

## 代码质量与实现约束

### 中文注释要求

首批源码必须满足：

- 使用中文注释
- 注释密度不低于每 5 行代码 1 行注释

注释要求解释：

- 解释模块职责
- 解释协议差异处理
- 解释关键数据流

不鼓励的注释：

- 对显而易见的赋值逐行解释
- 与代码内容重复的空洞注释

### 避免过早抽象

首批不应引入：

- 通用插件系统
- 复杂 provider 注册中心
- 多层工厂嵌套
- 抽象到无法直接看懂的数据转换框架

实现应优先保持：

- 文件职责单一
- 逻辑路径直接
- provider 差异显式可见

### 不做防御性编程

这里的含义不是忽略必要校验，而是避免：

- 对不可能出现的状态堆积分支
- 层层 fallback
- 过度包装错误
- 为未来未发生需求写复杂分流

首批实现应只对当前已确认的输入和协议做清晰处理。

## 与元文档的关系

本次实现属于 `thinkable` 子领域下的 `llm` 能力，但当前文档树中尚未单独存在 `meta/object/thinkable/llm/` 节点。

因此，实施阶段很可能需要新增文档概念，例如：

- `meta/object/thinkable/llm/index.doc.js`

并在以下位置建立引用关系：

- `meta/object/thinkable/index.doc.js`
- 必要时在更上层入口中暴露该子节点

由于用户已明确要求“如果代码里缺少和源代码相对应的概念，应当补充文档，但需要用户确认”，因此在真正新增这部分元文档前，需要再次征求用户确认。

## 交付完成标准

本批次设计落地后，至少满足：

- Bun 项目初始化完成
- `src/thinkable/llm/` 目录建立完成
- 存在统一 `LlmClient` 门面
- 支持 OpenAI 协议文本生成与流式文本输出
- 支持 Claude 协议文本生成与流式文本输出
- 能从 `.env` 的 `OOC_*` 读取配置
- 自动化测试覆盖配置解析、provider 选择、流式归一化与统一输出
- 源码满足中文注释密度要求

## 实施前确认事项

在进入真正实现前，需要额外确认一件事：

1. 是否允许在 `meta/object/thinkable/` 下新增与 `src/thinkable/llm/` 对应的 `doc.js` 文档节点

如果允许，再进入实现阶段。
