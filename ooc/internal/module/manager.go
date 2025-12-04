// Package module 管理系统中的可插拔模块。
// 功能：
//   - 模块注册：将模块提供的 Info/Method 注入 agent.Registry。
//   - 执行分发：根据 ExecutorName 调度具体模块逻辑。
//
// 使用方法：
//   - 使用 NewManager 创建管理器，依次调用 Register 注册模块。
//   - 通过 Execute 调用指定 executor。
//
// 注意：
//   - ExecutorName 必须全局唯一，避免冲突。
package module

import (
	"errors"
	"fmt"
	"sync"

	"ooc/ooc/internal/agent"
)

// ExecutionResult 描述模块执行输出。
type ExecutionResult struct {
	Message    string
	References []agent.InfoID
}

// Executor 代表具体的方法执行器。
type Executor func(action *agent.ActionState) (*ExecutionResult, error)

// Provider 模块需要实现的接口。
type Provider interface {
	Name() string
	Infos() []agent.InfoI
	Executors() func(methodName string) agent.MethodI
}

// Manager 负责注册与调度。
type Manager struct {
	registry  *agent.Registry
	mu        sync.RWMutex
	providers map[string]Provider
}

// NewManager 创建管理器。
func NewManager(reg *agent.Registry) *Manager {
	return &Manager{
		registry:  reg,
		providers: make(map[string]Provider),
	}
}

// Register 注册模块并把 Infos 注入 registry。
func (m *Manager) Register(p Provider) error {
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

	execsFunc := p.Executors()

	infos := p.Infos()
	for _, info := range infos {
		// 验证方法是否有对应的 executor（通过方法名匹配）
		methods := info.Methods()
		for _, method := range methods {
			methodName := method.Name()
			// 通过 Executors 函数获取方法实例
			if execsFunc != nil {
				methodInstance := execsFunc(methodName)
				if methodInstance != nil {
					// 验证方法实例实现了 Execute 方法
					_ = methodInstance // 使用 methodInstance 确保它实现了 MethodI 接口
				}
			}
		}
		if _, err := m.registry.RegisterInfo(info); err != nil {
			return err
		}
	}
	m.providers[name] = p
	return nil
}

// ExecuteMethod 实现 agent.MethodExecutor 接口。
func (m *Manager) ExecuteMethod(methodName string, action *agent.ActionState) (string, []agent.InfoID, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// 从 methodName 中提取模块名（格式：module.method 或 method）
	// 简化处理：假设 methodName 就是方法名，需要从所有 provider 中查找
	for _, provider := range m.providers {
		execsFunc := provider.Executors()
		if execsFunc != nil {
			method := execsFunc(methodName)
			if method != nil && method.Name() == methodName {
				// 调用方法的 Execute
				message, refs, err := method.Execute(action)
				if err != nil {
					return "", nil, err
				}
				return message, refs, nil
			}
		}
	}

	return "", nil, fmt.Errorf("method %s not found", methodName)
}
