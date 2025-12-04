// Package agent 的 registry.go 用于管理 Info/Conversation/Action 的生命周期。
// 功能：
//   - 提供线程安全的注册、查询、释放接口。
//   - 维护引用关系（如 Conversation 内的 Action 列表）。
//
// 使用方式：
//   - 通过 NewRegistry 创建实例，再通过各类 Register 方法写入。
//
// 注意事项：
//   - 所有方法都必须是并发安全的。
//   - 生成的 ID 保证在单进程内唯一即可。
package agent

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
)

// Registry 统一存储所有对象。
type Registry struct {
	idGen idGenerator

	mu            sync.RWMutex
	infos         map[InfoID]InfoI
	conversations map[ConversationID]*ConversationState
	actions       map[ActionID]*ActionState
}

// idGenerator 用简单自增保证单进程唯一。
type idGenerator struct {
	counter atomic.Int64
}

func (g *idGenerator) next(prefix string) string {
	val := g.counter.Add(1)
	return fmt.Sprintf("%s-%d", prefix, val)
}

// NewRegistry 创建一个空的 Registry。
func NewRegistry() *Registry {
	return &Registry{
		infos:         make(map[InfoID]InfoI),
		conversations: make(map[ConversationID]*ConversationState),
		actions:       make(map[ActionID]*ActionState),
	}
}

// RegisterInfo 写入 InfoI 并返回分配的 ID。
func (r *Registry) RegisterInfo(info InfoI) (InfoID, error) {
	if info == nil {
		return "", errors.New("info is nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	id := InfoID(r.idGen.next("info"))
	r.infos[id] = info
	return id, nil
}

// GetInfo 根据 ID 获取信息对象。
func (r *Registry) GetInfo(id InfoID) (InfoI, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	obj, ok := r.infos[id]
	return obj, ok
}

// ReleaseInfo 删除信息对象。
func (r *Registry) ReleaseInfo(id InfoID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.infos[id]; !ok {
		return fmt.Errorf("info %s not found", id)
	}
	delete(r.infos, id)
	return nil
}

// RegisterConversation 注册对话。
func (r *Registry) RegisterConversation(conv *ConversationState) (ConversationID, error) {
	if conv == nil {
		return "", errors.New("conversation is nil")
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if conv.ID == "" {
		conv.ID = ConversationID(r.idGen.next("conv"))
	}
	r.conversations[conv.ID] = conv
	return conv.ID, nil
}

// GetConversation 返回对话。
func (r *Registry) GetConversation(id ConversationID) (*ConversationState, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	conv, ok := r.conversations[id]
	return conv, ok
}

// RegisterAction 直接注册一个 Action，不附着在 Conversation 上。
func (r *Registry) RegisterAction(action *ActionState) (ActionID, error) {
	if action == nil {
		return "", errors.New("action is nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if action.ID == "" {
		action.ID = ActionID(r.idGen.next("act"))
	}
	r.actions[action.ID] = action
	return action.ID, nil
}

// GetAction 查询动作。
func (r *Registry) GetAction(id ActionID) (*ActionState, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	act, ok := r.actions[id]
	return act, ok
}

// AttachAction 将动作附加到对话并注册。
func (r *Registry) AttachAction(convID ConversationID, action *ActionState) error {
	if action == nil {
		return errors.New("action is nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	conv, ok := r.conversations[convID]
	if !ok {
		return fmt.Errorf("conversation %s not found", convID)
	}

	if action.ID == "" {
		action.ID = ActionID(r.idGen.next("act"))
	}
	action.Conversation = convID
	r.actions[action.ID] = action
	conv.ActionIDs = append(conv.ActionIDs, action.ID)
	return nil
}
