// Package llm 的 Fake 实现，用于测试。
package llm

import (
	"encoding/json"
	"sync"
)

// FakeClient 用于测试的假客户端。
type FakeClient struct {
	mu        sync.RWMutex
	responses map[string]*Response
}

// NewFakeClient 创建 Fake 客户端。
func NewFakeClient() *FakeClient {
	return &FakeClient{
		responses: make(map[string]*Response),
	}
}

// AddResponse 添加预设响应。
func (f *FakeClient) AddResponse(promptKey string, resp *Response) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.responses[promptKey] = resp
}

// Call 调用 LLM（Fake 实现）。
func (f *FakeClient) Call(req *Request) (*Response, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()

	// 尝试匹配 prompt。
	if resp, ok := f.responses[req.Prompt]; ok {
		return resp, nil
	}

	// 默认返回 Respond。
	return &Response{
		Method:     "Respond",
		Content:    "Fake response for: " + req.Prompt,
		Parameters: json.RawMessage("{}"),
	}, nil
}
