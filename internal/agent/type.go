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

import (
	"encoding/json"
	"fmt"
	"time"
)

// InfoID 唯一标识一个信息对象。
type InfoID = string

func WrapInfoID(class string, id string) InfoID {
	return fmt.Sprintf("%s::%s", class, id)
}

// ConversationID 唯一标识一个对话。
type ConversationID = string

// InfoI 定义可交互信息对象的接口（参考 meta.md 5-23）。
type InfoI interface {
	ID() string
	Class() string
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
	Parameters() string                            // JSON Schema
	Execute(conv *Conversation) (*Activity, error) // 执行方法（Activity 模式的 Conversation）
}

// Method 的执行默认会经过额外一轮 thinkloop 来帮助 Agent 构造 Method 的参数
// 如果 Method 的参数足够简单，不需要额外的 LLM 交互，可以实现这个接口
type MethodWithoutFuzzyI interface {
	MethodI
	WithoutFuzzy()
}

type CommonParams struct {
	Title      string            `json:"title,omitempty"`
	Content    string            `json:"content,omitempty"`
	References map[string]string `json:"references,omitempty"` // key: InfoID, val: reason
}

// ConversationMode 定义对话的执行模式。
type ConversationMode string

const (
	// ConversationModeManual 人工模式：由用户进行输入和回复
	ConversationModeManual ConversationMode = "manual"
	// ConversationModeHosted 托管模式：由 LLM 自动执行 thinkloop
	ConversationModeHosted ConversationMode = "hosted"
	// ConversationModeSemiHosted 半托管模式：LLM 给出要执行的行动，用户确认（可修改）后再执行
	ConversationModeSemiHosted ConversationMode = "semi_hosted"
)

const StatusRunning = "running" // status 默认为 running
const StatusWaitingAnswer = "waiting_answer"
const StatusWaitingRespond = "waiting_respond"
const StatusWaitingManualThink = "waiting_manual_think" // 等待用户手动思考（人工模式、半托管模式）
const StatusCompleted = "completed"
const StatusError = "error"

// Conversation 记录一次对话的上下文。
// 同时用于普通 Conversation 和 Action（Action 是特殊化的 Conversation）。
type Conversation struct {
	engine *Engine

	IDValue ConversationID // 对话唯一标识（含 class 前缀）
	From    InfoID         // 发起对话的信息对象 ID
	To      InfoID         // 对话目标信息对象 ID
	// Parent 父级 Conversation ID（用于追问场景，将子会话串联到父会话）
	Parent ConversationID

	Title string // 对话标题
	Desc  string // 对话描述

	Request  CommonParams // 对话请求（包含内容和引用）
	Response CommonParams // 对话响应（包含内容和引用）

	Questions []*Question // 角色 To 向 From 提出的问题

	Activities []*Activity // 对话活动列表（talk/act/ask 等）

	Status string // 对话状态（如 completed、waiting_answer、error）
	Error  string // 错误信息（当 Status 为 error 时）

	Mode ConversationMode // 对话执行模式（manual/hosted/semi_hosted），默认为 manual

	// 半托管模式相关字段
	WaitingManualThinkRequest *ManualThinkRequest // 等待用户手动思考的请求（半托管模式）

	// 时间戳字段
	UpdatedAt time.Time // 最后更新时间
}

// ManualThinkRequest 记录等待用户手动思考的请求（半托管模式）
type ManualThinkRequest struct {
	ConversationID ConversationID  // 对话 ID
	Prompt         string          // 当前的 prompt
	Tools          []string        // 可用的工具列表
	LLMMethod      string          // LLM 输出的方法名
	LLMParams      json.RawMessage // LLM 输出的参数
}

type Activity struct {
	Typ string // talk / act / ask

	// when typ is talk
	ConversationID ConversationID

	// when typ is act
	Object   InfoID
	Method   string
	Request  json.RawMessage
	Response CommonParams

	// when typ is ask
	QuestionID int64
}

type Question struct {
	Id       int64
	Question CommonParams
	Answer   CommonParams
}

// IsAction 判断是否为 Action 模式的 Conversation。
func (c *Conversation) IsAction() bool {
	info, _ := c.engine.registry.GetInfo(c.To)
	return info.Class() == "method"
}

func (c *Conversation) UpdateStatus() {
	if c.Status == StatusCompleted {
		return
	}
	if c.Status == StatusError {
		return // 错误状态不可恢复
	}
	for _, q := range c.Questions {
		if q.Answer.Content == "" {
			c.Status = StatusWaitingAnswer
			c.UpdatedAt = time.Now()
			return
		}
	}
	if c.Status == StatusWaitingAnswer {
		c.Status = StatusRunning
		c.UpdatedAt = time.Now()
	}
}

// UpdateTimestamp 更新 Conversation 的时间戳
func (c *Conversation) UpdateTimestamp() {
	c.UpdatedAt = time.Now()
}

type methodAsInfo struct {
	MethodI
}

func (m *methodAsInfo) ID() string {
	return WrapInfoID(m.Class(), m.Name())
}

func (m *methodAsInfo) Class() string {
	return "method"
}

func (m *methodAsInfo) Name() string {
	return m.MethodI.Name()
}

func (m *methodAsInfo) Description() string {
	return m.MethodI.Description()
}

func (m *methodAsInfo) Prompt() string {
	return m.MethodI.Document()
}

func (m *methodAsInfo) Methods() []MethodI {
	return []MethodI{m.MethodI}
}
