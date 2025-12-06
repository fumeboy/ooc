// Package agent 的 conversation.focus.go 处理 Focus 特殊方法。
package agent

type MethodRespond struct {
	e          *Engine
	Content    string            `json:"content,omitempty"`
	Summary    string            `json:"summary,omitempty"`    // 对话过程总结，会设置到 Conversation.Desc
	References map[string]string `json:"references,omitempty"` // key: InfoID, val: reason
}

var _ MethodWithoutFuzzyI = (*MethodRespond)(nil)

func (t *MethodRespond) WithoutFuzzy() {}

// Name 返回方法名称
func (l *MethodRespond) Name() string { return "respond" }

// Description 返回方法描述
func (l *MethodRespond) Description() string { return "向这次 Conversion 的提出方回复问题" }

// Document 返回方法文档
func (l *MethodRespond) Document() string {
	return `向这次 Conversion 的提出方回复问题，回复的内容是 Content，回复时可以引用其他有关的信息对象帮助思考。

在回复时，建议提供一个 Summary（总结）字段，对这次对话的过程进行总结，包括：
- 对话的主要目标和任务
- 执行的关键步骤
- 产生的重要结果或信息对象
- 遇到的困难和解决方案

Summary 会被设置到 Conversation 的 Desc 字段，用于后续回顾和理解对话上下文。`
}

// Parameters 返回参数 JSON Schema
func (l *MethodRespond) Parameters() string {
	return `{
		"type": "object",
		"properties": {
			"content": {
				"type": "string",
				"description": "回复内容"
			},
			"summary": {
				"type": "string",
				"description": "对话过程总结，包括主要目标、关键步骤、重要结果等，会被设置到 Conversation.Desc 字段"
			},
			"references": {
				"type": "object",
				"description": "引用的信息对象 ID 列表",
				"properties": {
					"key": {
						"type": "string",
						"description": "信息对象 ID"
					},
					"value": {
						"type": "string",
						"description": "引用原因"
					}
				}
			}
		},
		"required": ["content"]
	}`
}

const StatusCompleted = "completed"
const StatusError = "error"

func (t *MethodRespond) Execute(conv *Conversation) (*Action, error) {
	conv.Response = CommonParams{
		Content:    t.Content,
		References: t.References,
	}

	// 如果提供了总结，设置到 Conversation.Desc
	if t.Summary != "" {
		conv.Desc = t.Summary
	}

	conv.Status = StatusCompleted

	return nil, nil
}
