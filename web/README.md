# Web 前端规划

## 目标
- 可视化 Session/Conversation 过程。
- 支持查看 Info 信息
- 支持 LLM 附身，在收到 LLM 请求 时提示用户输入，转发到后端。
- 支持对 Conversation 的 Ask 进行响应，在收到 Ask 时提示用户输入，转发到后端。

## 页面设计(伪代码)
```xml
<page>
    <left>
        <tab_page title="conversation_tree">
            以 session 的 root conversation 为起点展示 conversation tree
            conversation tree 的每个节点可以展开，展开后展示 conversation 的详细信息，不展开时无需从后端请求查询详细信息，避免无效的计算

            对于 root conversation，如果有未回复的 question 信息，则在旁边显示 answer 按钮，允许对 question 进行回答
            <button> 刷新按钮, 刷新session 和 root conversation info</button>
        </tab_page>
        <tab_page title="info_list">
            展示 session 的所有 info 列表
            默认只展示 id name description， 可以通过按钮“查看详情”，查看具体的 prompt 和 methods
            <button> 刷新按钮, 刷新info 列表</button>
        </tab_page>
        <tab_page title="LLM requests">
            展示附身状态下收到的 LLM 请求，并展示文本框允许代替 LLM 进行回复
            刷新 session 后，如果存在未回复的 LLM 请求，则标记红点
        </tab_page>
        <button> 顶级刷新按钮, 刷新session</button>
    </left>
    <right>
        <head>
            固定高度
            发起 session 的输入框，输入框有一个配置项“是否开启LLM附身”，默认开启；中途允许切换附身状态
        </head>
        <body>
            固定高度
            可滚动列表
            展示历史创建的 session
        </body>
</page>
```

## 技术栈
- React + Vite + Typescript + shadcn/ui + Tailwind CSS

## TDD
- 使用组件测试 (Testing Library) + Playwright 端到端。

## TODO
- [ ] 设计 UI 草图。
- [ ] 定义与后端的 DTO。
