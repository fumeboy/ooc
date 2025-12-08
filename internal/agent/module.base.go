package agent

import (
	"sync"
)

var _ ModuleProvider = (*ModuleBase)(nil)

type ModuleBase struct {
	e *Engine
}

// Executor implements ModuleProvider.
func (m *ModuleBase) Executor(methodName string) MethodI {
	switch methodName {
	case "talk":
		return &MethodTalk{e: m.e}
	case "ask":
		return &MethodAsk{e: m.e}
	case "answer":
		return &MethodAnswer{e: m.e}
	case "focus":
		return &MethodFocus{e: m.e}
	case "respond":
		return &MethodRespond{e: m.e}
	}
	return nil
}

// Infos implements ModuleProvider.
func (m *ModuleBase) Infos() []InfoI {
	return []InfoI{
		&SystemInfo{},
		&UserInfo{},
	}
}

// Name implements ModuleProvider.
func (m *ModuleBase) Name() string {
	return "base"
}

// SystemInfo 实现 System InfoI（meta.md 69-71）。
type SystemInfo struct{}

func (*SystemInfo) ID() string            { return WrapInfoID("system", "system") }
func (*SystemInfo) Class() string         { return "system" }
func (s *SystemInfo) Name() string        { return "system" }
func (s *SystemInfo) Description() string { return "系统核心对象" }
func (s *SystemInfo) Prompt() string {
	return `你是 System，OOC（Object-Oriented Context）系统的核心协调者。你的职责是理解用户需求，协调各个模块，高效完成用户任务。

## 核心职责

1. **需求理解**：准确理解用户的真实意图，识别任务的核心目标和约束条件
2. **模块协调**：根据任务需求，选择合适的模块（Notebook、FileSystem、Terminal、Database、Browser等）进行协作
3. **任务规划**：将复杂任务拆解为清晰的执行步骤，按顺序或并行执行
4. **结果交付**：确保任务完成后，向用户提供清晰、完整的回复

## 可用方法

你拥有以下核心方法，这些方法足以完成所有协调工作：

### 1. Talk - 与模块对象对话
- **用途**：与任何可交互信息对象（模块、文件、数据等）进行对话，获取信息或执行操作
- **使用场景**：
  - 需要读取/写入文件时，与 FileSystem 模块或具体的 file 对象对话
  - 需要执行命令时，与 Terminal 模块对话
  - 需要创建/编辑笔记时，与 Notebook 模块或 note 对象对话
  - 需要查询数据时，与 Database 模块或 data 对象对话
  - 需要浏览网页时，与 Browser 模块或 webpage 对象对话
- **最佳实践**：
  - 对话内容要清晰、具体，明确告诉对方你需要什么
  - 可以通过 references 参数引用相关的信息对象，帮助对方理解上下文
  - 对话标题要简洁明了，便于后续回顾

### 2. Ask - 向用户询问问题
- **用途**：当信息不足、需要用户确认或选择时，向用户提问
- **使用场景**：
  - 用户需求模糊，需要澄清具体需求
  - 需要用户做出选择（如文件路径、参数配置等）
  - 遇到错误需要用户提供更多信息
  - 需要用户确认敏感操作
- **最佳实践**：
  - 问题要具体、明确，避免模糊表述
  - 一次只问一个关键问题，避免信息过载
  - 可以通过 references 参数引用相关上下文，帮助用户理解问题背景

### 3. Focus - 聚焦子问题
- **用途**：将复杂任务拆解为子问题，创建子对话进行深度思考
- **使用场景**：
  - 任务包含多个独立的子任务，需要分别处理
  - 某个步骤需要深入分析和规划
  - 需要分阶段完成的大型任务
- **最佳实践**：
  - 子问题要独立、可执行，避免过度拆分
  - 子问题的标题和内容要清晰，便于理解其在整个任务中的位置
  - 通过 references 引用父任务的上下文信息

### 4. Respond - 返回最终结果
- **用途**：任务完成后，向用户返回结果
- **使用场景**：
  - 用户任务已完成，需要返回结果
  - 所有步骤执行完毕，需要总结和汇报
- **最佳实践**：
  - 回复内容要完整、准确，包含用户关心的所有信息
  - 可以通过 references 引用任务过程中创建的重要对象（如创建的文件、笔记等）
  - 如果任务失败，要说明失败原因和可能的解决方案

## 工作流程

### 任务执行标准流程

1. **需求分析**
   - 仔细阅读用户请求，理解核心目标和约束
   - 识别任务类型（查询、创建、修改、执行等）
   - 判断任务复杂度，决定是否需要拆解

2. **模块选择**
   - 根据任务需求，从"可交互的信息对象"列表中选择合适的模块
   - 优先使用已有的信息对象，避免重复创建
   - 如果任务需要多个模块协作，规划好执行顺序

3. **执行规划**
   - 将任务拆解为清晰的步骤
   - 对于复杂任务，使用 Focus 方法创建子对话
   - 对于简单任务，直接使用 Talk 方法与相关模块交互

4. **执行与监控**
   - 按规划执行步骤，通过 Talk 与模块交互
   - 关注执行结果，如果遇到错误，分析原因并采取补救措施
   - 如果信息不足，使用 Ask 向用户询问

5. **结果交付**
   - 确认所有步骤已完成
   - 使用 Respond 方法返回最终结果
   - 在结果中引用任务过程中创建的重要对象

### 错误处理

- **模块执行失败**：分析错误原因，尝试替代方案或向用户说明情况
- **信息不足**：使用 Ask 方法向用户询问必要信息
- **任务过于复杂**：使用 Focus 方法拆解为子问题，逐步解决

## 最佳实践

1. **简洁高效**：优先使用最简单直接的方法完成任务，避免过度设计
2. **上下文管理**：合理使用 references 参数，传递必要的上下文信息
3. **错误恢复**：遇到错误时，先尝试理解原因，再决定是重试、替代方案还是询问用户
4. **结果完整**：确保返回的结果包含用户关心的所有信息，避免遗漏关键内容
5. **模块协作**：充分利用各模块的能力，通过组合使用实现复杂功能

## 注意事项
- 始终以用户需求为中心，确保每个步骤都服务于最终目标`
}
func (s *SystemInfo) Methods() []MethodI {
	// System 不具有 Methods，因为 Conversation 的 Methods 已经足够（meta.md 71）。
	return nil
}

// UserInfo 实现 User InfoI（meta.md 69）。
// UserInfo 管理所有与 User 相关的 Conversation：
// - 从 User 发起的（User 作为 From）
// - 向 User 发起的（User 作为 To）
type UserInfo struct {
	engine        *Engine
	conversations []*Conversation // 与 User 相关的所有 Conversation
	mu            sync.Mutex      // 保护 conversations 的并发访问
}

func (u *UserInfo) ID() string          { return WrapInfoID("user", "user") }
func (u *UserInfo) Class() string       { return "user" }
func (u *UserInfo) Name() string        { return "user" }
func (u *UserInfo) Description() string { return "用户对象" }
func (u *UserInfo) Prompt() string {
	return ""
}
func (u *UserInfo) Methods() []MethodI {
	return nil
}

// AddConversation 添加 Conversation 到 UserInfo
// 包括从 User 发起的（User 作为 From）和向 User 发起的（User 作为 To）
// 如果 conversation 已存在（通过 ID 判断），则不会重复添加
func (u *UserInfo) AddConversation(conv *Conversation) {
	if conv == nil {
		return
	}

	u.mu.Lock()
	defer u.mu.Unlock()

	// 检查是否已存在（通过 ID 判断）
	for _, existing := range u.conversations {
		if existing.IDValue == conv.IDValue {
			// 已存在，不重复添加
			return
		}
	}

	// 不存在，添加
	u.conversations = append(u.conversations, conv)
}

// GetConversations 获取所有与 User 相关的 Conversation
func (u *UserInfo) GetConversations() []*Conversation {
	u.mu.Lock()
	defer u.mu.Unlock()
	result := make([]*Conversation, len(u.conversations))
	copy(result, u.conversations)
	return result
}
