# Storybook 端到端测试

## 功能
- 模拟用户使用情况，真实运行系统、真实调用 LLM 接口。
- 验证整个系统的端到端流程。

## 使用方法

### 运行所有测试用例
```bash
go run ooc/cmd/storybook -all
```

### 运行指定测试用例
```bash
go run ooc/cmd/storybook -story Hello
go run ooc/cmd/storybook -story CreateNote
go run ooc/cmd/storybook -story ListNotes
go run ooc/cmd/storybook -story ComplexTask
```

### 处理 Ask 情况
当 LLM 使用 Ask 方法询问问题时，需要阻塞并等待用户回答。

## 测试用例

1. **Hello**: 简单的问候对话
   - 请求：你好，请介绍一下你自己
   - 验证：System 能够正确响应

2. **CreateNote**: 创建笔记
   - 请求：请帮我创建一条笔记，标题是'今日计划'，内容是'完成项目文档'
   - 验证：能够成功创建笔记

3. **ListNotes**: 列出所有笔记
   - 请求：请列出所有笔记
   - 验证：能够返回笔记列表

4. **ComplexTask**: 复杂任务
   - 请求：请深入分析软件开发中'技术债'这个概念。你需要从以下几个维度进行全面分析：...
   - 验证：能够完成多步骤任务

## 注意事项
- 这些测试用例会真实调用 LLM 接口，需要配置正确的 API Key。
- 测试用例可能需要较长时间完成，请耐心等待。
- 如果遇到 Ask 情况，需要提供用户回答才能继续。

