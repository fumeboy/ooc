package config

import (
	"os"
	"path/filepath"
	"testing"
)

// findConfigFile 查找配置文件。
func findConfigFile() string {
	// 从当前目录向上查找 .conf.xml。
	dir, _ := os.Getwd()
	for {
		path := filepath.Join(dir, ".conf.xml")
		if _, err := os.Stat(path); err == nil {
			return path
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ".conf.xml" // 默认值
}

// TestLoadConfig 验证配置加载。
func TestLoadConfig(t *testing.T) {
	cfgPath := findConfigFile()
	cfg, err := LoadFromFile(cfgPath)
	if err != nil {
		t.Fatalf("load config failed: %v", err)
	}
	if cfg.AI.Provider != "zhipuai" {
		t.Fatalf("unexpected provider %s", cfg.AI.Provider)
	}
	if cfg.AI.Model != "glm-4.6" {
		t.Fatalf("unexpected model %s", cfg.AI.Model)
	}
	if cfg.AI.APIKey == "" {
		t.Fatalf("api key is empty")
	}
}

// TestLoadConfigEnvOverride 验证环境变量覆盖。
func TestLoadConfigEnvOverride(t *testing.T) {
	os.Setenv("OOC_AI_MODEL", "glm-4")
	defer os.Unsetenv("OOC_AI_MODEL")

	cfgPath := findConfigFile()
	cfg, err := LoadFromFile(cfgPath)
	if err != nil {
		t.Fatalf("load config failed: %v", err)
	}
	if cfg.AI.Model != "glm-4" {
		t.Fatalf("expected model glm-4, got %s", cfg.AI.Model)
	}
}
