package notebook

import (
	"encoding/json"
	"fmt"

	"ooc/internal/agent"
)

// ListNotes 实现 MethodI 接口，表示列出笔记的方法。
type ListNotes struct {
	// Module 指向所属模块，用于执行时访问存储。
	Module *Module
}

// 确保 ListNotes 实现 MethodI 接口。
var _ agent.MethodI = (*ListNotes)(nil)

// Name 返回方法名称。
func (l *ListNotes) Name() string { return MethodListNotes }

// Description 返回方法描述。
func (l *ListNotes) Description() string { return "列出当前笔记" }

// Document 返回方法文档。
func (l *ListNotes) Document() string {
	return "列出所有已创建的笔记，返回笔记列表的 JSON 格式。"
}

// Parameters 返回参数 JSON Schema（此方法无需参数）。
func (l *ListNotes) Parameters() string {
	return `{
		"type": "object",
		"properties": {}
	}`
}

// Execute 执行列出笔记操作（实现 agent.MethodI.Execute）。
func (l *ListNotes) Execute(conv *agent.Conversation) (*agent.Action, error) {
	if l.Module == nil {
		return nil, fmt.Errorf("module is nil")
	}

	l.Module.mu.RLock()
	defer l.Module.mu.RUnlock()

	data, err := json.Marshal(l.Module.notes)
	if err != nil {
		return nil, err
	}
	return &agent.Action{
		Response: agent.CommonParams{
			Content: string(data),
		},
	}, nil
}
