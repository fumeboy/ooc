package module

import (
	"fmt"
	"testing"

	"ooc/ooc/internal/agent"
)

// fakeInfo 用于测试的简单 InfoI 实现。
type fakeInfo struct {
	name        string
	description string
	prompt      string
	methods     []agent.MethodI
}

func (f *fakeInfo) Name() string             { return f.name }
func (f *fakeInfo) Description() string      { return f.description }
func (f *fakeInfo) Prompt() string           { return f.prompt }
func (f *fakeInfo) Methods() []agent.MethodI { return f.methods }

// fakeMethod 用于测试的简单 MethodI 实现。
type fakeMethod struct {
	name        string
	description string
	document    string
	parameters  string
	executeFunc func(action *agent.ActionState) (string, []agent.InfoID, error)
}

func (f *fakeMethod) Name() string        { return f.name }
func (f *fakeMethod) Description() string { return f.description }
func (f *fakeMethod) Document() string    { return f.document }
func (f *fakeMethod) Parameters() string  { return f.parameters }
func (f *fakeMethod) Execute(action *agent.ActionState) (string, []agent.InfoID, error) {
	if f.executeFunc != nil {
		return f.executeFunc(action)
	}
	return "ok", nil, nil
}

// fakeProvider 用于测试注册流程。
type fakeProvider struct {
	name      string
	infos     []agent.InfoI
	executors func(methodName string) agent.MethodI
}

func (f *fakeProvider) Name() string { return f.name }
func (f *fakeProvider) Infos() []agent.InfoI {
	return f.infos
}
func (f *fakeProvider) Executors() func(methodName string) agent.MethodI {
	return f.executors
}

// TestManagerRegisterAndExecute 验证模块注册与执行。
func TestManagerRegisterAndExecute(t *testing.T) {
	reg := agent.NewRegistry()
	mgr := NewManager(reg)

	info := &fakeInfo{
		name:        "fake",
		description: "test info",
		prompt:      "test prompt",
		methods:     nil,
	}
	fakeMethod := &fakeMethod{
		name:        "do",
		description: "test method",
		document:    "test document",
		parameters:  "{}",
		executeFunc: func(action *agent.ActionState) (string, []agent.InfoID, error) {
			return "ok", nil, nil
		},
	}
	info.methods = []agent.MethodI{fakeMethod}

	provider := &fakeProvider{
		name:  "fake",
		infos: []agent.InfoI{info},
		executors: func(methodName string) agent.MethodI {
			if methodName == "do" {
				return fakeMethod
			}
			return nil
		},
	}

	if err := mgr.Register(provider); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	// Info 应该被写入 registry（通过遍历查找）。
	found := false
	for i := 1; i <= 10; i++ {
		id := agent.InfoID(fmt.Sprintf("info-%d", i))
		gotInfo, ok := reg.GetInfo(id)
		if ok && gotInfo.Name() == info.Name() {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("info not stored in registry")
	}

	// 执行方法。
	message, _, err := mgr.ExecuteMethod("do", &agent.ActionState{MethodName: "do"})
	if err != nil {
		t.Fatalf("execute failed: %v", err)
	}
	if message != "ok" {
		t.Fatalf("unexpected result message: %s", message)
	}
}

// TestManagerDuplicateRegister 验证重复注册报错。
func TestManagerDuplicateRegister(t *testing.T) {
	reg := agent.NewRegistry()
	mgr := NewManager(reg)

	provider := &fakeProvider{
		name:      "dup",
		infos:     []agent.InfoI{&fakeInfo{name: "dup"}},
		executors: func(methodName string) agent.MethodI { return nil },
	}
	if err := mgr.Register(provider); err != nil {
		t.Fatalf("first register failed: %v", err)
	}
	if err := mgr.Register(provider); err == nil {
		t.Fatalf("expect error on duplicate register")
	}
}
