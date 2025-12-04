package agent

import (
	"testing"

	"ooc/ooc/internal/client/llm"
)

// TestConversationTalk 验证对话的基本思考循环。
func TestConversationTalk(t *testing.T) {
	reg := NewRegistry()
	fakeLLM := llm.NewFakeClient()
	fakeLLM.AddResponse("test prompt", &llm.Response{
		Method:  "Respond",
		Content: "Hello",
	})

	// 创建测试 Info。
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

	// 设置 FakeClient 响应（匹配实际生成的 prompt）。
	fakeLLM.AddResponse("You are system. test prompt\n\nRequest: Hello", &llm.Response{
		Method:  "Respond",
		Content: "Hello",
	})

	// 执行 ThinkLoop。
	engine := NewConversationEngine(reg, fakeLLM, nil)
	result, err := engine.ThinkLoop(convID)
	if err != nil {
		t.Fatalf("talk failed: %v", err)
	}
	if result != "Hello" {
		t.Fatalf("unexpected result %s", result)
	}
}
