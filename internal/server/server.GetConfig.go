// Package server 提供 HTTP API 服务。
package server

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// ConfigResponse 配置信息响应。
type ConfigResponse struct {
	AI AIConfigResponse `json:"ai"`
}

// AIConfigResponse AI 配置响应（隐藏敏感信息）。
type AIConfigResponse struct {
	Provider  string `json:"provider"`
	APIKey    string `json:"api_key"`    // 部分隐藏，只显示前4位和后4位
	BaseURL   string `json:"base_url"`
	Model     string `json:"model"`
	MaxTokens int    `json:"max_tokens"`
	Timeout   int    `json:"timeout"`
}

// GetConfig 获取当前系统配置信息（GET /conf 或 GET /api/conf）。
func (s *Server) GetConfig(c echo.Context) error {
	if s.config == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "config not loaded",
		})
	}

	// 处理 API Key，只显示前4位和后4位，中间用 * 替代
	apiKey := s.config.AI.APIKey
	maskedAPIKey := maskAPIKey(apiKey)

	return c.JSON(http.StatusOK, ConfigResponse{
		AI: AIConfigResponse{
			Provider:  s.config.AI.Provider,
			APIKey:    maskedAPIKey,
			BaseURL:   s.config.AI.BaseURL,
			Model:     s.config.AI.Model,
			MaxTokens: s.config.AI.MaxTokens,
			Timeout:   s.config.AI.Timeout,
		},
	})
}

// maskAPIKey 隐藏 API Key 的中间部分，只显示前4位和后4位。
func maskAPIKey(apiKey string) string {
	if len(apiKey) <= 8 {
		// 如果 API Key 太短，全部用 * 替代
		return strings.Repeat("*", len(apiKey))
	}

	// 显示前4位和后4位，中间用 * 替代
	prefix := apiKey[:4]
	suffix := apiKey[len(apiKey)-4:]
	middle := strings.Repeat("*", len(apiKey)-8)

	return prefix + middle + suffix
}

