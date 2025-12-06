package llm

import (
	"testing"

	"ooc/internal/utils/config"
)

// TestHTTPClientCreation 验证 HTTP 客户端创建。
func TestHTTPClientCreation(t *testing.T) {
	cfg := &config.AIConfig{
		APIKey:    "test-key",
		BaseURL:   "https://test.com/",
		Model:     "glm-4",
		Timeout:   30,
		MaxTokens: 1000,
	}

	client := NewHTTPClient(cfg)
	if client == nil {
		t.Fatalf("client is nil")
	}
	if client.baseURL != cfg.BaseURL {
		t.Fatalf("unexpected base URL")
	}
}
