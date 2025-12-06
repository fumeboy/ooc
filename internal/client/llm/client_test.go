package llm

import (
	"testing"
)

// TestFakeClient 验证 FakeClient 基本功能。
func TestFakeClient(t *testing.T) {
	client := NewFakeClient()
	client.AddResponse("test", &Response{
		Method:  "Respond",
		Content: "Hello",
	})

	resp, err := client.Call(&Request{
		Prompt: "test",
	})
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}
	if resp.Method != "Respond" {
		t.Fatalf("unexpected method %s", resp.Method)
	}
	if resp.Content != "Hello" {
		t.Fatalf("unexpected content %s", resp.Content)
	}
}
