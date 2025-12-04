// Package llm 的 HTTP 客户端实现（zhipu ai）。
package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"ooc/ooc/internal/utils/config"
)

// HTTPClient 真实 HTTP LLM 客户端。
type HTTPClient struct {
	cfg     *config.AIConfig
	client  *http.Client
	baseURL string
}

// NewHTTPClient 创建 HTTP 客户端。
func NewHTTPClient(cfg *config.AIConfig) *HTTPClient {
	timeout := time.Duration(cfg.Timeout) * time.Second
	if timeout == 0 {
		timeout = 300 * time.Second
	}

	return &HTTPClient{
		cfg:     cfg,
		client:  &http.Client{Timeout: timeout},
		baseURL: cfg.BaseURL,
	}
}

// Call 调用 LLM API。
func (c *HTTPClient) Call(req *Request) (*Response, error) {
	// 构建请求体。
	payload := c.buildPayload(req)

	// 创建 HTTP 请求。
	httpReq, err := http.NewRequest("POST", c.baseURL+"chat/completions", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// 设置 headers。
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)

	// 发送请求。
	resp, err := c.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	// 读取响应。
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("api error: %s, body: %s", resp.Status, string(body))
	}

	// 解析响应。
	return c.parseResponse(body)
}

// buildPayload 构建请求体。
func (c *HTTPClient) buildPayload(req *Request) []byte {
	// 构建 messages。
	messages := []map[string]interface{}{
		{
			"role":    "user",
			"content": req.Prompt,
		},
	}

	// 构建 tools（如果有）。
	tools := []map[string]interface{}{}
	for _, tool := range req.Tools {
		tools = append(tools, map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        tool.Name,
				"description": tool.Description,
			},
		})
	}

	payload := map[string]interface{}{
		"model":      c.cfg.Model,
		"messages":   messages,
		"max_tokens": c.cfg.MaxTokens,
	}

	if len(tools) > 0 {
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
	}

	data, _ := json.Marshal(payload)
	return data
}

// parseResponse 解析 API 响应。
func (c *HTTPClient) parseResponse(body []byte) (*Response, error) {
	var apiResp struct {
		Choices []struct {
			Message struct {
				Role      string `json:"role"`
				Content   string `json:"content"`
				ToolCalls []struct {
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if len(apiResp.Choices) == 0 {
		return nil, fmt.Errorf("no choices in response")
	}

	msg := apiResp.Choices[0].Message

	// 如果有 tool_calls，解析为方法调用。
	if len(msg.ToolCalls) > 0 {
		tc := msg.ToolCalls[0]
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(tc.Function.Arguments), &params); err != nil {
			params = make(map[string]interface{})
		}

		return &Response{
			Method:     tc.Function.Name,
			Content:    msg.Content,
			Parameters: params,
		}, nil
	}

	// 否则返回普通响应（Respond）。
	return &Response{
		Method:  "Respond",
		Content: msg.Content,
	}, nil
}
