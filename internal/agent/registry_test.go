package agent

import (
	"testing"
)

// testInfo 用于测试的简单 InfoI 实现。
type testInfo struct {
	name        string
	description string
	prompt      string
	methods     []MethodI
}

func (t *testInfo) Class() string       { return "test" }
func (t *testInfo) Name() string        { return t.name }
func (t *testInfo) Description() string { return t.description }
func (t *testInfo) Prompt() string      { return t.prompt }
func (t *testInfo) Methods() []MethodI  { return t.methods }

// TestRegistryRegisterAndRetrieveInfo 验证信息对象的注册与查询。
func TestRegistryRegisterAndRetrieveInfo(t *testing.T) {
	var reg = &Registry{
		infos: make(map[InfoID]InfoI),
	}
	info := &testInfo{
		name:        "notebook",
		description: "记录笔记",
		prompt:      "prompt",
	}

	id, err := reg.RegisterInfo(info)
	if err != nil {
		t.Fatalf("register info failed: %v", err)
	}
	if id == "" {
		t.Fatalf("expected non-empty id")
	}

	got, ok := reg.GetInfo(id)
	if !ok {
		t.Fatalf("info not found")
	}
	if got.Name() != info.Name() {
		t.Fatalf("expected name %s, got %s", info.Name(), got.Name())
	}
}

// TestRegistryReleaseInfo 验证释放后无法再次获取。
func TestRegistryReleaseInfo(t *testing.T) {
	var reg = &Registry{
		infos: make(map[InfoID]InfoI),
	}
	id, err := reg.RegisterInfo(&testInfo{name: "fs"})
	if err != nil {
		t.Fatalf("register info failed: %v", err)
	}

	if err := reg.ReleaseInfo(id); err != nil {
		t.Fatalf("release failed: %v", err)
	}
	if _, ok := reg.GetInfo(id); ok {
		t.Fatalf("info should be removed after release")
	}
}

// TestRegistryConversationLifecycle 覆盖对话注册与引用追踪。
func TestRegistryConversationLifecycle(t *testing.T) {
	var reg = &Registry{
		infos: make(map[InfoID]InfoI),
	}
	infoID, err := reg.RegisterInfo(&testInfo{name: "user"})
	if err != nil {
		t.Fatalf("register info failed: %v", err)
	}
	conv := &Conversation{
		From: infoID,
		To:   infoID,
	}
	convID, err := reg.RegisterConversation(conv)
	if err != nil {
		t.Fatalf("register conversation failed: %v", err)
	}

	stored, ok := reg.GetConversation(convID)
	if !ok {
		t.Fatalf("conversation not found")
	}
	if stored.From != infoID {
		t.Fatalf("unexpected from id")
	}
}
