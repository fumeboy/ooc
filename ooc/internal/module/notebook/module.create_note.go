package notebook

import (
	"encoding/json"
	"fmt"

	"ooc/ooc/internal/agent"
)

// CreateNote 实现 MethodI 接口，表示创建笔记的方法。
type CreateNote struct {
	// Title 笔记标题（必填）。
	Title string
	// Content 笔记内容（可选）。
	Content string
	// Module 指向所属模块，用于执行时访问存储。
	Module *Module
}

// 确保 CreateNote 实现 MethodI 接口。
var _ agent.MethodI = (*CreateNote)(nil)

// Name 返回方法名称。
func (c *CreateNote) Name() string { return MethodCreateNote }

// Description 返回方法描述。
func (c *CreateNote) Description() string { return "创建新笔记" }

// Document 返回方法文档。
func (c *CreateNote) Document() string {
	return "创建一条新笔记，需要提供 title 和可选的 content。"
}

// Parameters 返回参数 JSON Schema。
func (c *CreateNote) Parameters() string {
	return `{
		"type": "object",
		"properties": {
			"title": {
				"type": "string",
				"description": "笔记标题"
			},
			"content": {
				"type": "string",
				"description": "笔记内容"
			}
		},
		"required": ["title"]
	}`
}

// Execute 执行创建笔记操作（实现 agent.MethodI.Execute）。
func (c *CreateNote) Execute(action *agent.ActionState) (string, []agent.InfoID, error) {
	if c.Module == nil {
		return "", nil, fmt.Errorf("module is nil")
	}

	// 从 action.ParameterJSON 解析参数。
	if action.ParameterJSON != "" {
		var params struct {
			Title   string `json:"title"`
			Content string `json:"content"`
		}
		if err := json.Unmarshal([]byte(action.ParameterJSON), &params); err != nil {
			return "", nil, fmt.Errorf("parse parameters: %w", err)
		}
		c.Title = params.Title
		c.Content = params.Content
	}

	if c.Title == "" {
		return "", nil, fmt.Errorf("title is required")
	}

	c.Module.mu.Lock()
	defer c.Module.mu.Unlock()

	c.Module.next++
	note := Note{
		ID:      fmt.Sprintf("note-%d", c.Module.next),
		Title:   c.Title,
		Content: c.Content,
	}
	c.Module.notes = append(c.Module.notes, note)

	msg := fmt.Sprintf("created note %s", note.ID)
	return msg, nil, nil
}
