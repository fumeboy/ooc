// Package session 实现用户 Session 生命周期与事件管理。
// 用途：
//   - 保存一次用户请求的上下文（故事、结果、状态等）。
//   - 附加 Conversation/Action 事件，供前端或调试回放。
//
// 使用方式：
//   - 通过 Store 接口写入/读取 Session。
//   - 当前提供内存实现 NewMemoryStore，后续可替换为持久化版本。
//
// 注意：
//   - 所有导出函数都应具备并发安全性。
package session

import (
	"errors"
	"fmt"
	"ooc/internal/agent"
	"sync"
	"sync/atomic"
	"time"
)

// SessionID 唯一标识一个 Session。
type SessionID string

// EventID 唯一标识一条事件。
type EventID string

// SessionStatus 描述当前状态。
type SessionStatus string

const (
	// SessionStatusPending 会话正在进行。
	SessionStatusPending SessionStatus = "pending"
	// SessionStatusCompleted 会话完成。
	SessionStatusCompleted SessionStatus = "completed"
	// SessionStatusWaitingAnswer 会话等待用户回答。
	SessionStatusWaitingAnswer SessionStatus = "waiting_answer"
	// SessionStatusWaitingPossess 会话等待用户确认/修改 LLM 输出（附身模式）。
	SessionStatusWaitingPossess SessionStatus = "waiting_possess"
	// SessionStatusFailed 会话失败。
	SessionStatusFailed SessionStatus = "failed"
)

// Session 记录一次用户请求的整体信息。
type Session struct {
	ID          SessionID
	UserRequest string
	Result      *agent.CommonParams
	Status      SessionStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Engine      *agent.Engine

	// 附身功能相关字段
	Possessed      bool                  // 是否处于附身状态
	PossessRequest *agent.PossessRequest // 当前的附身请求（等待用户回复）
}

// EventType 区分不同事件。
type EventType string

const (
	// EventConversationStarted 会话开始。
	EventConversationStarted EventType = "conversation_started"
	// EventActionExecuted 执行具体方法。
	EventActionExecuted EventType = "action_executed"
	// EventAskRaised LLM 发起 Ask。
	EventAskRaised EventType = "ask_raised"
	// EventRespondSent 用户响应。
	EventRespondSent EventType = "respond_sent"
	// EventConversationEnded 会话结束。
	EventConversationEnded EventType = "conversation_ended"
)

// Event 描述某一瞬间的系统行为。
type Event struct {
	ID        EventID
	SessionID SessionID
	Type      EventType
	Payload   string
	CreatedAt time.Time
}

// Store 定义 Session 存储接口。
type Store interface {
	SaveSession(*Session) (SessionID, error)
	GetSession(SessionID) (*Session, bool)
	ListSessions() []*Session
	AppendEvent(SessionID, *Event) (EventID, error)
	ListEvents(SessionID) ([]*Event, error)
}

// MemoryStore 提供线程安全的内存实现。
type MemoryStore struct {
	mu       sync.RWMutex
	sessions map[SessionID]*Session
	events   map[SessionID][]*Event
	idGen    atomic.Int64
	eventGen atomic.Int64
}

// NewMemoryStore 创建内存存储。
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		sessions: make(map[SessionID]*Session),
		events:   make(map[SessionID][]*Event),
	}
}

// SaveSession 写入或更新 Session。
func (m *MemoryStore) SaveSession(sess *Session) (SessionID, error) {
	if sess == nil {
		return "", errors.New("session is nil")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	if sess.ID == "" {
		sess.ID = SessionID(fmt.Sprintf("session-%d", m.idGen.Add(1)))
		sess.CreatedAt = now
	} else {
		sess.UpdatedAt = now
	}
	if sess.Status == "" {
		sess.Status = SessionStatusPending
	}
	m.sessions[sess.ID] = sess
	return sess.ID, nil
}

// GetSession 读取 Session。
func (m *MemoryStore) GetSession(id SessionID) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sess, ok := m.sessions[id]
	return sess, ok
}

// ListSessions 返回全部会话。
func (m *MemoryStore) ListSessions() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]*Session, 0, len(m.sessions))
	for _, sess := range m.sessions {
		list = append(list, sess)
	}
	return list
}

// AppendEvent 写入事件。
func (m *MemoryStore) AppendEvent(id SessionID, evt *Event) (EventID, error) {
	if evt == nil {
		return "", errors.New("event is nil")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.sessions[id]; !ok {
		return "", fmt.Errorf("session %s not found", id)
	}
	evt.SessionID = id
	if evt.ID == "" {
		evt.ID = EventID(fmt.Sprintf("event-%d", m.eventGen.Add(1)))
	}
	if evt.CreatedAt.IsZero() {
		evt.CreatedAt = time.Now()
	}
	m.events[id] = append(m.events[id], evt)
	return evt.ID, nil
}

// ListEvents 返回某会话的事件列表。
func (m *MemoryStore) ListEvents(id SessionID) ([]*Event, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.sessions[id]; !ok {
		return nil, fmt.Errorf("session %s not found", id)
	}
	evts := m.events[id]
	result := make([]*Event, len(evts))
	copy(result, evts)
	return result, nil
}
