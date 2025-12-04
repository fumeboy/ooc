// Package agent 定义 Agent 内核使用的核心数据结构。
// 用途：
//   - 对可交互信息对象、方法、会话和动作做统一建模。
//   - 为思考循环提供上下文载体。
//
// 使用：
//   - 其他包通过这些类型与 Registry、循环逻辑交互。
//
// 注意：
//   - 所有字段命名遵循简单直观原则，避免过度抽象。
package agent

// InfoID 唯一标识一个信息对象。
type InfoID string

// ConversationID 唯一标识一个对话。
type ConversationID string

// ActionID 唯一标识一个动作。
type ActionID string

// InfoI 定义可交互信息对象的接口（参考 meta.md 5-23）。
type InfoI interface {
	Name() string
	Description() string
	Prompt() string
	Methods() []MethodI
}

// MethodI 定义方法的接口（参考 meta.md 17-22）。
type MethodI interface {
	Name() string
	Description() string
	Document() string
	Parameters() string                                    // JSON Schema
	Execute(action *ActionState) (string, []InfoID, error) // 执行方法
}

// ConversationState 记录一次对话的上下文。
type ConversationState struct {
	ID          ConversationID    // 对话唯一标识
	From        InfoID            // 发起对话的信息对象 ID
	To          InfoID            // 对话目标信息对象 ID
	Content     string            // 对话内容（用户请求或子问题）
	References  []InfoID          // 引用的其他信息对象 ID 列表
	ActionIDs   []ActionID        // 对话中执行的动作 ID 列表
	Metadata    map[string]string // 元数据（如 ask_message、ask_timestamp 等）
	Status      string            // 对话状态（如 completed、waiting_for_user）
	ReasonTrace []string          // 推理过程追踪
}

// ActionState 表示 Method 执行过程中的一次动作。
type ActionState struct {
	ID            ActionID       // 动作唯一标识
	Conversation  ConversationID // 所属对话 ID
	TargetInfo    InfoID         // 目标信息对象 ID
	MethodName    string         // 要执行的方法名称
	Request       string         // 自然语言描述的执行请求
	References    []InfoID       // 可能相关的信息对象 ID 列表
	Status        string         // 动作状态（如 completed、failed）
	ErrorMessage  string         // 错误信息（如果失败）
	Response      string         // 执行结果消息
	ParameterJSON string         // 方法参数的 JSON 字符串
}
