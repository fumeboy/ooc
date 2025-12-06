// Package llm 的 HTTP 客户端实现（zhipu ai）。
package llm

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"ooc/internal/utils/config"
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

// Call 调用 LLM API，支持错误重试。
func (c *HTTPClient) Call(req *Request) (*Response, error) {
	const maxRetries = 3
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		// 构建请求体（每次重试时，Messages 可能已经更新）。
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
			lastErr = fmt.Errorf("send request: %w", err)
			// 将错误信息追加到 Messages 中，然后重试。
			if attempt < maxRetries-1 {
				c.appendErrorToMessages(req, lastErr.Error())
				continue
			}
			return nil, lastErr
		}

		// 读取响应。
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("read response: %w", err)
			if attempt < maxRetries-1 {
				c.appendErrorToMessages(req, lastErr.Error())
				continue
			}
			return nil, lastErr
		}

		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("api error: %s, body: %s", resp.Status, string(body))
			// 将错误信息追加到 Messages 中，然后重试。
			if attempt < maxRetries-1 {
				c.appendErrorToMessages(req, lastErr.Error())
				continue
			}
			return nil, lastErr
		}

		// 解析响应。
		llmResp, err := c.parseResponse(body)
		if err != nil {
			lastErr = fmt.Errorf("parse response: %w", err)
			// 将错误信息追加到 Messages 中，然后重试。
			if attempt < maxRetries-1 {
				c.appendErrorToMessages(req, lastErr.Error())
				continue
			}
			return nil, lastErr
		}

		// 成功，返回结果。
		return llmResp, nil
	}

	return nil, fmt.Errorf("max retries exceeded: %w", lastErr)
}

// appendErrorToMessages 将错误信息追加到 Messages 中。
func (c *HTTPClient) appendErrorToMessages(req *Request, errorMsg string) {
	if req.Messages == nil {
		req.Messages = []Message{}
	}
	req.Messages = append(req.Messages, Message{
		Role:    "assistant",
		Content: fmt.Sprintf("Error occurred: %s. Please retry.", errorMsg),
	})
	req.Messages = append(req.Messages, Message{
		Role:    "user",
		Content: "Please retry the previous request.",
	})
}

// buildPayload 构建请求体。
func (c *HTTPClient) buildPayload(req *Request) []byte {
	// 构建 messages。
	messages := []map[string]any{}

	// 如果有历史消息，先添加历史消息。
	for _, msg := range req.Messages {
		messages = append(messages, map[string]any{
			"role":    msg.Role,
			"content": msg.Content,
		})
	}

	// 添加当前的 prompt。
	messages = append(messages, map[string]any{
		"role":    "user",
		"content": req.Prompt,
	})

	// 构建 tools（如果有）。
	tools := []map[string]any{}
	for _, tool := range req.Tools {
		tools = append(tools, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        tool.Name,
				"description": tool.Description,
				"parameters":  tool.Parameters,
			},
		})
	}

	payload := map[string]any{
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
		// 直接使用 Function.Arguments 作为 json.RawMessage。
		params := json.RawMessage(tc.Function.Arguments)
		if len(params) == 0 {
			params = json.RawMessage("{}")
		}

		return &Response{
			Method:     tc.Function.Name,
			Content:    msg.Content,
			Parameters: params,
		}, nil
	}

	return nil, errors.New("no tool calls in response")
}
