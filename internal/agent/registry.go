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

	mu    sync.RWMutex
	infos map[InfoID]InfoI
}

// idGenerator 用简单自增保证单进程唯一。
type idGenerator struct {
	counter atomic.Int64
}

func (g *idGenerator) next(prefix string) string {
	val := g.counter.Add(1)
	return fmt.Sprintf("%s-%d", prefix, val)
}

// RegisterInfo 写入 InfoI 并返回分配的 ID。
func (r *Registry) RegisterInfo(info InfoI) (InfoID, error) {
	if info == nil {
		return "", errors.New("info is nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	id := WrapInfoID(info.Class(), info.Name())
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
func (r *Registry) RegisterConversation(conv *Conversation) (ConversationID, error) {
	if conv.ID == "" {
		conv.ID = ConversationID(r.idGen.next("conv"))
	}
	r.RegisterInfo(conv)
	return conv.ID, nil
}

// GetConversation 返回对话。
func (r *Registry) GetConversation(id ConversationID) (*Conversation, bool) {
	info, ok := r.GetInfo(WrapInfoID("conversation", id))
	if !ok {
		return nil, false
	}
	return info.(*Conversation), true
}

// ListAllInfo 返回所有注册的信息对象。
func (r *Registry) ListAllInfo() map[InfoID]InfoI {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[InfoID]InfoI, len(r.infos))
	for id, info := range r.infos {
		result[id] = info
	}
	return result
}
