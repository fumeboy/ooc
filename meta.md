# OOC(Object-Oriented Context)

OOC 是一个 Agent 系统，它的核心概念是 面向对象式 的 Agent 协作机制

## 基础概念

在这个系统中，核心的抽象 叫做 可交互信息对象(InfoI)，InfoI 具有 名称、对外介绍、私有提示词、私有方法

抽象如下：
```go
type InfoI interface {
    Name() string
    Description() string
    Prompt() string
    Methods() []MethodI
}
type MethodI interface {
    Name() string
    Description() string
    Document() string
    Parameters() string // JSON Schema
}
```

每个可交互信息对象都是可对话的，也可以认为可交互信息对象的唯一 public 方法是 Talk 方法，
当与一个可交互信息对象 Talk 时，就会产生一个 Conversation 对象

Conversation 由四个参数构造
    From 参数：谁发起的对话
    To 参数：与哪个可交互信息对象对话
    Content: 对话内容
    References: 引用的其他相关的可交互信息对象的 id 列表
Conversation 本身也是一个可交互信息对象，对它进行 Talk 会在原有上下文的基础上产生一个新的 Conversation

Talk 是一次思考循环过程，这个过程中会以 Conversion.To 对象为主视角与 LLM 交互，构造信息给 LLM，然后 LLM 选择要执行的 Method，并返回执行结果，Method 的返回结果可以包括新的 可交互信息对象 的引用
然后基于新的上下文继续思考，直到 LLM 输出特殊的 Method: Respond 来返回这次对话的结果
Conversation 的初始参数 Content、 References 以及 TalkWith 对象的 Prompt、Methods 作为最初的上下文，随着思考循环的进行，上下文会不断更新
Conversation 的上下文包括:
- Conversation.To 的 Prompt: 可交互信息对象的私有提示词
- Request: 用户输入的原始需求
- Request.References: 用户输入的原始需求引用的其他相关的可交互信息对象
- Activities: 思考循环过程中的执行记录
- Methods: 可执行动作的列表

Conversation 的 思考循环 过程中，不需要告诉 LLM Conversation.From 是谁，只需要告诉 LLM 需要做出回复

对于 LLM 可执行的 Method，由四部分组成:
1. Conversation.To 对应的可交互信息对象的 私有 Methods，也只有它的 私有 Methods 会详细填充到 LLM 的上下文中，填充时只填充 method 的 name 和 description
2. Talk: 对于 Conversation 中涉及到的其他的可交互信息对象则只能进行 Talk 操作，LLM 需要知道如何与这些可交互信息对象进行 Talk
3. Respond: 当 LLM 输出特殊的 Method: Respond 来返回这次对话的结果时，Conversation 会结束，并将 Respond 的结果作为 Conversation 的结果
4. Ask: 当 LLM 需要向 Conversation.From 对象询问问题时，LLM 会输出特殊的 Method: Ask 来询问问题，Conversation.From 对象会收到 Ask 消息，并返回回答
5. Focus: 当 LLM 需要聚焦到一个子问题时，可以通过该方法创建一个 子 Conversation，这个 Conversation 的 From 和 To 都是自己，Content 是子问题，Ref 由 LLM 根据当前上下文生成

Conversation 的 LLM 在执行 Conversation.To 这个信息对象的 Method 时，并不直接构造 Method 的 Arguments，毕竟构造 LLM 的输入时，只告诉了它 Method 的 Name 和 Description，并没有告诉它 Method 的 Parameters，因此要执行 Method 前，还会再次创建一个 Conversation 对象，这个过程通过 Talk With Method 来实现：Method 也是一个信息对象，当 Method 作为 Conversation.To 时，上下文会展示这个 Method 的完整文档和参数，LLM 可以基于这个信息构造 Method 的 Arguments

## 用户交互

系统初始具有 User、System 两个可交互信息对象，以及可横向扩展的一组模块对象，例如 Notebook、FileSystem、Terminal 等模块，这些模块也会实现 InfoI 并可以进行 Talk 交互

System 对象不具有 Methods，因为 Conversation 的 Methods 已经足够

用户使用时，输入原始需求 Request，系统会创建一个 Conversion，From 对象是 User，To 对象是 System，Content 是 Request，References 是模块对象
然后系统会开始思考循环，和普通的 Conversation 一样，System 的 Prompt 和 Methods 定义 以及 Request，References 对象的描述 会传给 LLM 告诉 LLM 如何进行思考，以及如何执行 Method

在前端设计上，需要处理当 User 接收到 Ask 消息时的情况，需要显示一个输入框，用户可以输入回答，然后点击发送按钮，将回答发送给 Conversation.To 对象

在后端设计上，会通过 Session 来记录这一次 Agent 工作中的请求、过程、结果、中途产生的可交互信息对象

## 模块系统

系统支持接入多个 module，module 可以提供 可交互信息对象 给系统使用；每个 module 可以包含以下文件：
- **module.go**: 模块的实现文件，包含模块的初始化、注册等逻辑
- **module.method_name.go**: 模块提供的可调用方法的实现文件，包含方法的实现逻辑
- **object.info_classname.go**: 模块是信息的集合，模块提供的信息也会实现 InfoI 接口；例如 object.file.go 文件中定义了 file 可交互信息对象
- **object.info_classname.method_name.go**: 可交互信息对象 向 系统 提供的可调用方法; 例如 object.file.read.go 文件中定义了 file 可交互信息对象的 read 方法

### 模块设计

notebook
    meta:
        Agent 编写文档、计划、记录想法的地方
        Agent 的关键能力是使用 LLM 像人类一样进行思考，而问题的解决往往需要复杂的思考过程、信息查阅等，
		因此需要 notebook 来记录 Agent 的思考过程中的想法和各种信息
        notebook 初始会有一个 plan.md 文件，用于记录计划
    info:
        notebook 模块自身作为可交互信息对象，内容是 note 的索引列表

        notebook 的信息单元是 note 可交互信息对象，它具有以下属性:
            id 唯一标识
            title 标题
            summary 摘要
            content 内容
            created_at 创建时间
            updated_at 更新时间
    method:
        notebook 可以 创建 编辑 删除 文档
        文档创建、编辑时，设置、更新 note 的 summary
    
terminal:
    meta:
        Agent 的关键能力是操作数字世界，而其中的基础能力是计算和存储，Agent 可以通过 terminal 与数字世界交互
    info:
        terminal 的信息单元是 terminal_window
        terminal_window 是一个执行的 shell 进程，执行时，允许创建 daemon 进程，这样 Agent 执行后不会阻塞等待
        terminal_window 实现了 InfoI， 并可以展示这些信息:
            is_error 是否出错
            error 错误信息
            stdout 进程输出
            stderr 进程输出
        terminal_window 会在输出内容发生变化时通过 LLM 程序得到 summary
    method:
        terminal 可以 执行并等待shell命令、执行不等待shell命令(as daemon)、中断运行中的 daemon mode 的 terminal_window、关闭并删除 terminal_window


filesystem:
    meta:
        Agent 的关键能力是操作数字世界，而文件系统是数字世界的基础，因此 Agent 必须能够操作文件系统
        注意这里的 filesystem 并不是对 文件系统 API 的封装，而只是记录 “上下文中引用的文件”
    info:
        filesystem 的信息单元是 file
        file 实现了 canvas InfoI， 并可以展示这些信息:
            path 文件路径
            summary 文件内容描述
        summary 可以在注册文件引用时提供，也可以由 LLM 程序根据文件内容生成
        需要监听文件内容是否发生改变，如果改变，需要自动更新 summary
    method:
        filesystem 可以 创建 删除 文件引用
        file 可以 读取 编辑 删除

database:
    meta:
        Agent 的关键能力是操作数字世界，而其中的基础能力是计算和存储，Agent 需要存储在工作中产生的数据，用于解决问题
    info:
        database 的信息单元是 data
        data 是对数据的封装，具有这些属性:
            id 唯一标识
            name 名称
            typ 数据类型
            value 值
            from 来源
            mutable 是否可变
        data 实现了 canvas InfoI
        summary 会由 LLM 程序根据 data 的 value 生成，用于信息缩略时展示
    method:
        database 模块提供基本的增删改查接口

browser:
    meta:
        Agent 的关键能力是操作数字世界，而其中的基础能力是计算和存储，Agent 需要浏览网页，获取信息
    info:
        browser 的信息单元是 webpage
        webpage 实现了 canvas InfoI， 并可以展示这些信息:
            url 网页 URL
            title 网页标题
            summary 网页内容描述
    method:
        browser 可以 打开 关闭 网页

# 开发建议

使用 go 1.24.5 版本进行开发


## 开发原则

1. 元信息先行：先写好设计文档，再开始实现代码，每个程序模块都是如此；每当要修改程序，都必须先修改对应的设计文档
2. 代码结构清晰：每个程序模块的代码结构都应该是清晰的，易于理解；每个程序模块的代码都应该有清晰的中文注释，易于理解；并且在程序文件开头用注释概述整个文件的信息
3. 避免过早抽象、过度抽象，程序应当是简单、易懂、易维护的，非必要时，不使用 interface 类型，而是直接使用 struct 类型，并避免使用 any 类型和 reflect

## 目录结构

各个目录下都有一个 readme.md 文件，用于记录该目录下的工作内容和实现方案 以及 开发进度。
在开发具体模块时，你需要参考对应的 readme.md 文件，了解该模块的功能、接口、实现方案、开发进度等。

```
ooc/
├── README.md                 # 项目总览（本文件）
├── cmd/                      # 主程序入口
│   └── storybook/              # 测试用例集
│   │   └── README.md
│   │   └── stories.go        # 测试用例集的实现
│   │   └── stories_test.go   # 测试用例集的测试
│   └── server/              # HTTP 服务器入口
│       └── README.md
├── internal/                # 内部代码包
│   ├── utils/config/              # 配置模块
│   │   └── README.md
│   ├── client/              # 客户端模块
│   │   └── llm/             # LLM 客户端
│   │       └── README.md
│   ├── agent/              #  Agent 核心模块
│   │   └── README.md
│   ├── module/              # Agent 系统扩展模块
│   │   ├── README.md
│   │   ├── notebook/        # 笔记本模块
│   │   ├── terminal/        # 终端模块
│   │   ├── filesystem/      # 文件系统模块
│   │   ├── database/        # 数据库模块
│   │   └── browser/         # 浏览器模块
│   ├── session/             # 会话管理
│   │   └── README.md
│   └── server/              # HTTP API 服务
│       └── README.md
└── web/                 # 前端代码
    └── README.md
```

## Storybook （模拟用户使用情况的测试用例集）

基础测试用例

```go
var stories = []Story{
	{
		Name:        "Hello",
		Description: "基础问答测试，不涉及工具调用",
		Goal:        "你好，请简短地介绍一下你自己。",
	},
	{
		Name:        "ListFiles",
		Description: "简单的工具调用测试 (ls)",
		Goal:        "请列出当前目录下的所有文件，并告诉我是否存在 go.mod 文件。",
	},
	{
		Name:        "ComplexLogic",
		Description: "稍微复杂的逻辑，可能需要多步思考或子任务",
		Goal:        "请检查当前目录下是否有 README.md 文件，如果有，请读取它的前 5 行内容展示给我。",
	},
}
```

## 开发配置

本目录下的 .conf.xml 提供了 zhipu ai 的配置，包括 api key、base url、model、max_tokens、timeout 等，你在实现和 LLM 有关交互逻辑时，可以使用