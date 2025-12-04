package agent

import (
	"testing"

	"ooc/ooc/internal/client/llm"
)

// TestConversationAsk 验证 Ask 方法。
func TestConversationAsk(t *testing.T) {
	reg := NewRegistry()
	fakeLLM := llm.NewFakeClient()

	toInfo := &testInfo{
		name:        "system",
		description: "system",
		prompt:      "test prompt",
		methods:     nil,
	}
	toID, _ := reg.RegisterInfo(toInfo)

	conv := &ConversationState{
		From:    InfoID("user"),
		To:      toID,
		Content: "Hello",
	}
	convID, _ := reg.RegisterConversation(conv)

	fakeLLM.AddResponse("You are system. test prompt\n\nRequest: Hello", &llm.Response{
		Method:  "Ask",
		Content: "What is your name?",
	})

	engine := NewConversationEngine(reg, fakeLLM, nil)
	result, err := engine.ThinkLoop(convID)
	if err != nil {
		t.Fatalf("talk failed: %v", err)
	}
	if result != "What is your name?" {
		t.Fatalf("unexpected result %s", result)
	}

	// 验证状态。
	updated, _ := reg.GetConversation(convID)
	if updated.Status != "waiting_for_user" {
		t.Fatalf("expected status waiting_for_user, got %s", updated.Status)
	}
}

// TestConversationFocus 验证 Focus 方法。
func TestConversationFocus(t *testing.T) {
	reg := NewRegistry()
	fakeLLM := llm.NewFakeClient()

	toInfo := &testInfo{
		name:        "system",
		description: "system",
		prompt:      "test prompt",
		methods:     nil,
	}
	toID, _ := reg.RegisterInfo(toInfo)

	conv := &ConversationState{
		From:    InfoID("user"),
		To:      toID,
		Content: "Complex task",
	}
	convID, _ := reg.RegisterConversation(conv)

	// 第一次调用返回 Focus。
	fakeLLM.AddResponse("You are system. test prompt\n\nRequest: Complex task", &llm.Response{
		Method:  "Focus",
		Content: "Sub-task 1",
	})

	// 子对话返回 Respond。
	fakeLLM.AddResponse("You are system. test prompt\n\nRequest: Sub-task 1", &llm.Response{
		Method:  "Respond",
		Content: "Sub-task completed",
	})

	// 父对话继续返回 Respond。
	fakeLLM.AddResponse("You are system. test prompt\n\nRequest: Complex task", &llm.Response{
		Method:  "Respond",
		Content: "Task completed",
	})

	engine := NewConversationEngine(reg, fakeLLM, nil)
	result, err := engine.ThinkLoop(convID)
	if err != nil {
		t.Fatalf("talk failed: %v", err)
	}
	if result != "Task completed" {
		t.Fatalf("unexpected result %s", result)
	}
}
