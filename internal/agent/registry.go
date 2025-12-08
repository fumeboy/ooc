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
	"strings"
	"sync"
	"sync/atomic"
)

// Registry 统一存储所有对象。
type Registry struct {
	idGen idGenerator

	mu sync.RWMutex

	infos map[InfoID]InfoI

	maxConversations int
	conversationCnt  int
}

// idGenerator 用简单自增保证单进程唯一。
type idGenerator struct {
	counter atomic.Int64
}

func (g *idGenerator) next(prefix string) string {
	val := g.counter.Add(1)
	return fmt.Sprintf("%s-%d", prefix, val)
}

// SetMaxConversations 设置最大 Conversation 数量（<=0 表示不限制）。
func (r *Registry) SetMaxConversations(n int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.maxConversations = n
}

// RegisterInfo 写入 InfoI 并返回分配的 ID。
func (r *Registry) RegisterInfo(info InfoI) (InfoID, error) {
	if info == nil {
		return "", errors.New("info is nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	return r.registerInfoLocked(info)
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
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.maxConversations > 0 && r.conversationCnt >= r.maxConversations {
		return "", fmt.Errorf("conversation limit exceeded: %d", r.maxConversations)
	}

	if conv.IDValue == "" {
		raw := r.idGen.next("conv")
		conv.IDValue = ConversationID(WrapInfoID(conv.Class(), raw))
	}

	if _, err := r.registerInfoLocked(conv); err != nil {
		return "", err
	}

	r.conversationCnt++
	return conv.IDValue, nil
}

// GetConversation 返回对话。
func (r *Registry) GetConversation(id ConversationID) (*Conversation, bool) {
	key := string(id)
	if !strings.Contains(key, "::") {
		key = WrapInfoID("conversation", key)
	}
	info, ok := r.GetInfo(key)
	if !ok {
		return nil, false
	}
	return info.(*Conversation), true
}

// registerInfoLocked 在已持有写锁情况下注册 Info。
func (r *Registry) registerInfoLocked(info InfoI) (InfoID, error) {
	if info == nil {
		return "", errors.New("info is nil")
	}
	id := info.ID()
	if id == "" {
		return "", errors.New("info id is empty")
	}
	r.infos[id] = info
	return id, nil
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
