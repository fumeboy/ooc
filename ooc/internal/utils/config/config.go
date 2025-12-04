// Package config 提供配置加载功能。
// 用途：
//   - 从 XML 文件加载配置，支持环境变量覆盖。
//   - 提供统一的配置访问接口。
package config

import (
	"encoding/xml"
	"fmt"
	"os"
	"strconv"
)

// Config 系统配置根结构。
type Config struct {
	AI AIConfig `xml:"ai"`
}

// AIConfig LLM 相关配置。
type AIConfig struct {
	Provider  string `xml:"provider"`
	APIKey    string `xml:"api_key"`
	BaseURL   string `xml:"base_url"`
	Model     string `xml:"model"`
	MaxTokens int    `xml:"max_tokens"`
	Timeout   int    `xml:"timeout"`
}

// LoadFromFile 从文件加载配置并应用环境变量覆盖。
func LoadFromFile(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}

	var cfg Config
	if err := xml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse xml: %w", err)
	}

	// 应用环境变量覆盖。
	applyEnvOverrides(&cfg)

	return &cfg, nil
}

// applyEnvOverrides 应用环境变量覆盖。
func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("OOC_AI_PROVIDER"); v != "" {
		cfg.AI.Provider = v
	}
	if v := os.Getenv("OOC_AI_API_KEY"); v != "" {
		cfg.AI.APIKey = v
	}
	if v := os.Getenv("OOC_AI_BASE_URL"); v != "" {
		cfg.AI.BaseURL = v
	}
	if v := os.Getenv("OOC_AI_MODEL"); v != "" {
		cfg.AI.Model = v
	}
	if v := os.Getenv("OOC_AI_MAX_TOKENS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.AI.MaxTokens = n
		}
	}
	if v := os.Getenv("OOC_AI_TIMEOUT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.AI.Timeout = n
		}
	}
}
