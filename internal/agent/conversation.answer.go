// Package agent 的 conversation.focus.go 处理 Focus 特殊方法。
package agent

import "fmt"

// MethodAnswer 用于回复 ask 创建的问题
type MethodAnswer struct {
	e          *Engine
	QuestionID int64             `json:"question_id,omitempty"`
	Content    string            `json:"content,omitempty"`
	References map[string]string `json:"references,omitempty"` // key: InfoID, val: reason
}

var _ MethodWithoutFuzzyI = (*MethodAnswer)(nil)

func (t *MethodAnswer) WithoutFuzzy() {}

// Name 返回方法名称
func (l *MethodAnswer) Name() string { return "answer" }

// Description 返回方法描述
func (l *MethodAnswer) Description() string { return "回复 ask 创建的问题" }

// Document 返回方法文档
func (l *MethodAnswer) Document() string {
	return "回复 ask 创建的问题，回复的内容是 Content，回复时可以引用其他有关的信息对象帮助思考"
}

// Parameters 返回参数 JSON Schema
func (l *MethodAnswer) Parameters() string {
	return `{
		"type": "object",
		"properties": {
			"question_id": {
				"type": "string",
				"description": "问题 ID"
			},
			"content": {
				"type": "string",
				"description": "回复内容"
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
		"required": ["question_id", "content"]
	}`
}

func (t *MethodAnswer) Execute(conv *Conversation) (*Activity, error) {
	var question *Question
	for _, q := range conv.Questions {
		if q.Id == t.QuestionID {
			question = q
			break
		}
	}
	if question == nil || question.Id == 0 {
		return nil, fmt.Errorf("question %d not found", t.QuestionID)
	}

	question.Answer = CommonParams{
		Content:    t.Content,
		References: t.References,
	}

	conv.UpdateStatus()

	return nil, nil
}
