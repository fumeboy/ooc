// Package llm 提供 LLM 客户端接口。
// 用途：
//   - 封装与 LLM 的交互，支持真实 HTTP 和 Fake 实现。
//   - 提供统一的请求/响应格式。
package llm

import "encoding/json"

// Client LLM 客户端接口。
type Client interface {
	Call(req *Request) (*Response, error)
}

// Request LLM 请求。
type Request struct {
	Prompt   string
	Tools    []Tool
	Messages []Message
}

// Message 对话消息。
type Message struct {
	Role    string
	Content string
}

// Tool 工具定义。
type Tool struct {
	Name        string
	Description string
	Parameters  json.RawMessage
}

// Response LLM 响应。
type Response struct {
	Method      string // Respond/Talk/Ask/Focus 或具体方法名
	Content     string
	Parameters  json.RawMessage // 方法参数（JSON 格式，使用时需要 Unmarshal 为具体 struct）
	ReasonTrace []string
}
