// Package agent 管理系统中的可插拔模块。
// 功能：
//   - 模块注册：将模块提供的 Info/Method 注入 Registry。
//   - 执行分发：根据 ExecutorName 调度具体模块逻辑。
//
// 使用方法：
//   - 使用 NewManager 创建管理器，依次调用 Register 注册模块。
//   - 通过 Execute 调用指定 executor。
//
// 注意：
//   - ExecutorName 必须全局唯一，避免冲突。
package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// ModuleProvider 模块需要实现的接口。
type ModuleProvider interface {
	Name() string
	Infos() []InfoI // 模块初始提供的信息对象
	Executor(methodName string) MethodI
}

// ModuleManager 负责注册与调度。
type ModuleManager struct {
	registry  *Registry
	mu        sync.RWMutex
	providers map[string]ModuleProvider
}

func GetModuleManager(e *Engine) *ModuleManager {
	return e.executor
}

// Register 注册模块并把 Infos 注入 registry。
func (m *ModuleManager) Register(p ModuleProvider) error {
	if p == nil {
		return errors.New("provider is nil")
	}
	name := p.Name()
	if name == "" {
		return errors.New("provider name is empty")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.providers[name]; exists {
		return fmt.Errorf("provider %s already registered", name)
	}

	infos := p.Infos()
	for _, info := range infos {
		if _, err := m.registry.RegisterInfo(info); err != nil {
			return err
		}
		for _, method := range info.Methods() {
			if _, err := m.registry.RegisterInfo(&methodAsInfo{MethodI: method}); err != nil {
				return err
			}
		}
	}
	m.providers[name] = p
	return nil
}

// ExecuteMethod 实现 MethodExecutor 接口。
func (m *ModuleManager) ExecuteMethod(methodName string, conv *Conversation, request json.RawMessage) (*Action, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// 从 methodName 中提取模块名（格式：module.method 或 method）
	// 简化处理：假设 methodName 就是方法名，需要从所有 provider 中查找
	for _, provider := range m.providers {
		method := provider.Executor(methodName)
		if method != nil && method.Name() == methodName {
			err := json.Unmarshal(request, method)
			if err != nil {
				return nil, err
			}
			// 调用方法的 Execute
			action, err := method.Execute(conv)
			if err != nil {
				return nil, err
			}

			// action 可能为 nil（如 Respond 方法）
			if action != nil && action.Typ != "talk" {
				action.Request = request
				action.Typ = "act"
				action.Object = conv.To
				action.Method = methodName
			}
			return action, nil
		}
	}

	return nil, fmt.Errorf("method %s not found", methodName)
}
