package notebook

import "ooc/ooc/internal/agent"

// Note 代表单条笔记，实现 InfoI 接口。
type Note struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

// 确保 Note 实现 InfoI 接口。
var _ agent.InfoI = (*Note)(nil)

// Name 返回笔记名称。
func (n *Note) Name() string { return n.ID }

// Description 返回笔记描述。
func (n *Note) Description() string {
	if n.Title != "" {
		return n.Title
	}
	return "笔记 " + n.ID
}

// Prompt 返回笔记的私有提示词。
func (n *Note) Prompt() string {
	return "这是一条笔记，标题：" + n.Title + "，内容：" + n.Content
}

// Methods 返回笔记可执行的方法（当前为空，后续可扩展）。
func (n *Note) Methods() []agent.MethodI {
	return nil
}
