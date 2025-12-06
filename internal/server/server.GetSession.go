// Package server 提供 HTTP API 服务。
package server

import (
	"net/http"
	"time"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// GetSessionResponse 获取 Session 的响应。
type GetSessionResponse struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Possessed bool      `json:"possessed"` // 是否处于附身状态
}

// GetSession 获取 Session 状态（GET /sessions/{id}）。
func (s *Server) GetSession(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))
	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	// 动态检查 session 状态：根据 UserInfo 的 Conversations 状态聚合更新
	s.updateSessionStatusFromConversation(sess)

	possessed := false
	if sess.Engine != nil {
		possessed = sess.Engine.Possessed
	}

	return c.JSON(http.StatusOK, GetSessionResponse{
		ID:        string(sess.ID),
		Status:    string(sess.Status),
		CreatedAt: sess.CreatedAt,
		UpdatedAt: sess.UpdatedAt,
		Possessed: possessed,
	})
}

// updateSessionStatusFromConversation 根据 UserInfo 的 Conversations 状态聚合更新 session 状态
// 状态优先级从高到低为：waiting_manual_think、waiting_answer、running、error、completed
func (s *Server) updateSessionStatusFromConversation(sess *session.Session) {
	if sess.Engine == nil {
		return
	}

	engine := sess.Engine
	conversations := engine.GetConversations()

	if len(conversations) == 0 {
		// 没有 conversation，保持当前状态
		return
	}

	// 状态优先级映射：数字越小优先级越高
	statusPriority := map[string]int{
		agent.StatusWaitingManualThink: 1,
		agent.StatusWaitingAnswer:      2,
		agent.StatusRunning:            3,
		agent.StatusError:              4,
		agent.StatusCompleted:          5,
	}

	// 找到最高优先级的状态
	highestPriority := 999
	highestStatus := ""
	for _, conv := range conversations {
		priority, exists := statusPriority[conv.Status]
		if exists && priority < highestPriority {
			highestPriority = priority
			highestStatus = conv.Status
		}
	}

	// 如果找到了状态，更新 session
	if highestStatus != "" {
		newStatus := session.SessionStatus(highestStatus)
		if sess.Status != newStatus {
			sess.Status = newStatus
			s.store.SaveSession(sess)
		}
	}
}
