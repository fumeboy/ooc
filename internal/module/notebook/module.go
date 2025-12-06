// Package notebook 提供 Notebook 模块的最小实现。
// 用途：
//   - 记录 Agent 的计划与笔记。
//   - 通过 List/Create 方法演示模块注册与执行流程。
//
// 使用：
//   - 由 module.Manager 注册，executor 名称前缀为 notebook。
package notebook

import (
	"sync"

	"ooc/internal/agent"
)

const (
	// ModuleName Notebook 模块名。
	ModuleName = "notebook"

	// ExecutorCreateNote 创建笔记执行器。
	MethodCreateNote = "notebook.create"
	// ExecutorListNotes 列出笔记执行器。
	MethodListNotes = "notebook.list"
)

// Module Notebook 模块提供者，实现 InfoI 接口。
type Module struct {
	mu    sync.RWMutex
	notes []Note
	next  int
}

// 确保 Module 实现 InfoI 接口。
var _ agent.InfoI = (*Module)(nil)
var _ agent.ModuleProvider = (*Module)(nil)

func (m *Module) Class() string { return "notebook" }

// Name 返回模块名称。
func (m *Module) Name() string { return ModuleName }

// Description 返回模块描述。
func (m *Module) Description() string {
	return "Notebook 模块，负责记录 plan/notes"
}

// Prompt 返回模块的私有提示词。
func (m *Module) Prompt() string {
	return "Notebook 模块记录 Agent 的文档与计划。"
}

// Methods 返回模块提供的方法列表。
func (m *Module) Methods() []agent.MethodI {
	return []agent.MethodI{
		&CreateNote{Module: m},
		&ListNotes{Module: m},
	}
}

// NewModule 创建模块实例。
func NewModule() *Module {
	return &Module{}
}

// Infos 返回可注册的信息对象（满足 Provider 接口）。
func (m *Module) Infos() []agent.InfoI {
	return []agent.InfoI{m}
}

// Executors 返回方法获取函数。
func (m *Module) Executor(methodName string) agent.MethodI {
	switch methodName {
	case MethodCreateNote:
		return &CreateNote{Module: m}
	case MethodListNotes:
		return &ListNotes{Module: m}
	default:
		return nil
	}
}
