package notebook

import "ooc/internal/agent"

// Note 代表单条笔记，实现 InfoI 接口（参考 meta.md 99-105）。
type Note struct {
	Id        string `json:"id"`         // 唯一标识
	Title     string `json:"title"`      // 标题
	Summary   string `json:"summary"`    // 摘要（meta.md 102）
	Content   string `json:"content"`    // 内容
	CreatedAt string `json:"created_at"` // 创建时间（meta.md 104）
	UpdatedAt string `json:"updated_at"` // 更新时间（meta.md 105）
}

// 确保 Note 实现 InfoI 接口。
var _ agent.InfoI = (*Note)(nil)

func (n *Note) Class() string { return "note" }

// ID 返回笔记的唯一标识。
func (n *Note) ID() string { return n.Id }

// Name 返回笔记名称。
func (n *Note) Name() string { return n.Title }

// Description 返回笔记描述（优先使用 summary，其次 title）。
func (n *Note) Description() string {
	if n.Summary != "" {
		return n.Summary
	}
	if n.Title != "" {
		return n.Title
	}
	return "笔记 " + n.Id
}

// Prompt 返回笔记的私有提示词。
func (n *Note) Prompt() string {
	prompt := "这是一条笔记"
	if n.Title != "" {
		prompt += "，标题：" + n.Title
	}
	if n.Summary != "" {
		prompt += "，摘要：" + n.Summary
	}
	if n.Content != "" {
		prompt += "，内容：" + n.Content
	}
	return prompt
}

// Methods 返回笔记可执行的方法（当前为空，后续可扩展）。
func (n *Note) Methods() []agent.MethodI {
	return nil
}
