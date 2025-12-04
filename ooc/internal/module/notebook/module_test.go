package notebook

import (
	"testing"

	"ooc/ooc/internal/agent"
	modmgr "ooc/ooc/internal/module"
)

// TestNotebookModuleIntegration 验证 Notebook 模块可以注册并执行。
func TestNotebookModuleIntegration(t *testing.T) {
	reg := agent.NewRegistry()
	manager := modmgr.NewManager(reg)
	mod := NewModule()

	if err := manager.Register(mod); err != nil {
		t.Fatalf("register notebook failed: %v", err)
	}

	createPayload := `{"title":"Plan","content":"Think first"}`
	_, _, err := manager.ExecuteMethod("notebook.create", &agent.ActionState{
		ParameterJSON: createPayload,
	})
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}

	message, _, err := manager.ExecuteMethod("notebook.list", &agent.ActionState{})
	if err != nil {
		t.Fatalf("list notes failed: %v", err)
	}
	// 验证返回的消息包含笔记数据
	if message == "" {
		t.Fatalf("expected non-empty message")
	}
}
