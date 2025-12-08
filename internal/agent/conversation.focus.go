// Package agent 的 conversation.focus.go 处理 Focus 特殊方法。
package agent

// MethodFocus 是 TalkMethod 的一种特例, 用于创建子 Conversation, 这个子 Conversation 的 From 和 To 都是自己
type MethodFocus struct {
	e          *Engine
	Title      string            `json:"title,omitempty"`
	Content    string            `json:"content,omitempty"`
	References map[string]string `json:"references,omitempty"` // key: InfoID, val: reason
}

var _ MethodWithoutFuzzyI = (*MethodFocus)(nil)

func (t *MethodFocus) WithoutFuzzy() {}

// Name 返回方法名称。
func (l *MethodFocus) Name() string { return "focus" }

// Description 返回方法描述。
func (l *MethodFocus) Description() string { return "聚焦到一个子问题" }

// Document 返回方法文档。
func (l *MethodFocus) Document() string {
	return "聚焦到一个子问题，这个子问题的内容是 Content，提问/提出需求时可以引用其他有关的信息对象帮助思考"
}

// Parameters 返回参数 JSON Schema（此方法无需参数）。
func (l *MethodFocus) Parameters() string {
	return `{
		"type": "object",
		"properties": {
			"title": {
				"type": "string",
				"description": "子问题标题"
			},
			"content": {
				"type": "string",
				"description": "子问题内容"
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
		"required": ["title", "content"]
	}`
}

func (t *MethodFocus) Execute(conv *Conversation) (*Activity, error) {
	var talk MethodTalk
	talk.e = t.e
	talk.Title = t.Title
	talk.Content = t.Content
	talk.References = t.References
	talk.TalkWith = conv.To

	activity, err := talk.Execute(conv)
	if activity != nil {
		activity.Typ = "focus"
	}
	return activity, err
}
