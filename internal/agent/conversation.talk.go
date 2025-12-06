// Package agent 的 conversation.talk.go 处理 Talk 特殊方法。
package agent

import (
	"fmt"
)

type MethodTalk struct {
	e          *Engine
	Title      string            `json:"title,omitempty"`
	Content    string            `json:"content,omitempty"`
	References map[string]string `json:"references,omitempty"` // key: InfoID, val: reason
	TalkWith   string            `json:"talk_with,omitempty"`  // 要对话的信息对象 ID
}

var _ MethodWithoutFuzzyI = (*MethodTalk)(nil)

func (t *MethodTalk) WithoutFuzzy() {}

// Name 返回方法名称。
func (l *MethodTalk) Name() string { return "talk" }

// Description 返回方法描述。
func (l *MethodTalk) Description() string { return "与信息对象对话" }

// Document 返回方法文档。
func (l *MethodTalk) Document() string {
	return "向其他信息对象提问/提出需求，并获取回复，提问/提出需求时可以引用其他有关的信息对象帮助对方思考"
}

// Parameters 返回参数 JSON Schema（此方法无需参数）。
func (l *MethodTalk) Parameters() string {
	return `{
		"type": "object",
		"properties": {
			"talk_with": {
				"type": "string",
				"description": "要对话的信息对象 ID"
			},
			"title": {
				"type": "string",
				"description": "对话标题"
			},
			"content": {
				"type": "string",
				"description": "对话内容"
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
		"required": ["talk_with", "title", "content"]
	}`
}

func (t *MethodTalk) Execute(current *Conversation) (*Action, error) {
	// 验证目标对象存在。
	_, ok := t.e.registry.GetInfo(t.TalkWith)
	if !ok {
		return nil, fmt.Errorf("target info %s not found", t.TalkWith)
	}

	if t.Content == "" {
		return nil, fmt.Errorf("content is empty")
	}

	// 从 resp.Parameters 中获取 references（如果提供），并验证 Info 存在。
	validRefs := make(map[string]string)
	if t.References != nil {
		for refIDStr, reason := range t.References {
			refID := InfoID(refIDStr)
			// 验证 Info 存在。
			if _, exists := t.e.registry.GetInfo(refID); exists {
				validRefs[refIDStr] = reason
			}
		}
	}

	newConv := &Conversation{
		engine: t.e,
		Title:  t.Title,
		From:   current.To, // 当前对话的 To 作为新对话的 From
		To:     t.TalkWith,
		Request: CommonParams{
			Content:    t.Content,
			References: validRefs,
		},
	}

	newConvID, err := t.e.registry.RegisterConversation(newConv)
	if err != nil {
		return nil, fmt.Errorf("register talk conversation failed: %w", err)
	}

	// 执行新对话。
	err = t.e.ThinkLoop(newConv)
	if err != nil {
		return nil, fmt.Errorf("talk failed: %w", err)
	}

	// 将新对话的 ID 添加到当前对话的 Response.References。
	if current.Response.References == nil {
		current.Response.References = make(map[string]string)
	}
	current.Response.References[string(newConvID)] = "created by Talk"

	// 继续当前对话的思考循环。
	err = t.e.Think(current)
	if err != nil {
		return nil, fmt.Errorf("think failed: %w", err)
	}

	return &Action{
		Typ:            "talk",
		ConversationID: newConvID,
	}, nil
}
