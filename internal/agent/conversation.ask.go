// Package agent 的 conversation.focus.go 处理 Focus 特殊方法。
package agent

// MethodAsk 是 TalkMethod 的一种特例, 用于创建子 Conversation, 这个子 Conversation 的 From 和 To 都是自己
type MethodAsk struct {
	e          *Engine
	Content    string            `json:"content,omitempty"`
	References map[string]string `json:"references,omitempty"` // key: InfoID, val: reason
}

var _ MethodWithoutFuzzyI = (*MethodAsk)(nil)

func (t *MethodAsk) WithoutFuzzy() {}

// Name 返回方法名称
func (l *MethodAsk) Name() string { return "ask" }

// Description 返回方法描述
func (l *MethodAsk) Description() string { return "向这次 Conversion 的提出方询问问题" }

// Document 返回方法文档
func (l *MethodAsk) Document() string {
	return "向这次 Conversion 的提出方询问问题，这个问题的内容是 Content，提问时可以引用其他有关的信息对象帮助思考"
}

// Parameters 返回参数 JSON Schema
func (l *MethodAsk) Parameters() string {
	return `{
		"type": "object",
		"properties": {
			"content": {
				"type": "string",
				"description": "问题内容"
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

const StatusWaitingAnswer = "waiting_answer"

func (t *MethodAsk) Execute(conv *Conversation) (*Action, error) {
	conv.Questions = append(conv.Questions, &Question{
		Id: int64(len(conv.Questions)) + 1,
		Question: CommonParams{
			Content:    t.Content,
			References: t.References,
		},
		Answer: CommonParams{},
	})

	conv.Status = StatusWaitingAnswer

	return nil, nil
}
