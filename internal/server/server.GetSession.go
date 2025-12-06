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
	ID          string    `json:"id"`
	UserRequest string    `json:"user_request"`
	Result      string    `json:"result"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Possessed   bool      `json:"possessed"` // 是否处于附身状态
}

// GetSession 获取 Session 状态（GET /sessions/{id}）。
func (s *Server) GetSession(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))
	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	// 动态检查 session 状态：根据最新的 conversation 状态更新
	s.updateSessionStatusFromConversation(sess)

	result := ""
	if sess.Result != nil {
		result = sess.Result.Content
	}

	return c.JSON(http.StatusOK, GetSessionResponse{
		ID:          string(sess.ID),
		UserRequest: sess.UserRequest,
		Result:      result,
		Status:      string(sess.Status),
		CreatedAt:   sess.CreatedAt,
		UpdatedAt:   sess.UpdatedAt,
		Possessed:   sess.Possessed,
	})
}

// updateSessionStatusFromConversation 根据最新的 conversation 状态更新 session 状态
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

	// 如果 session 处于 waiting_possess 或 waiting_answer 状态，不自动更新
	if sess.Status == session.SessionStatusWaitingPossess || sess.Status == session.SessionStatusWaitingAnswer {
		return
	}

	// 获取最后一个 conversation（最新的用户请求）
	lastConv := conversations[len(conversations)-1]

	// 根据最后一个 conversation 的状态更新 session 状态
	if lastConv.Status == agent.StatusCompleted && lastConv.Response.Content != "" {
		// conversation 已完成且有 response，session 为 completed
		if sess.Status != session.SessionStatusCompleted {
			sess.Status = session.SessionStatusCompleted
			sess.Result = &lastConv.Response
			s.store.SaveSession(sess)
		}
	} else if lastConv.Status == agent.StatusWaitingAnswer {
		// conversation 等待用户回答
		if sess.Status != session.SessionStatusWaitingAnswer {
			sess.Status = session.SessionStatusWaitingAnswer
			s.store.SaveSession(sess)
		}
	} else if lastConv.Status == agent.StatusError {
		// conversation 出错
		if sess.Status != session.SessionStatusFailed {
			sess.Status = session.SessionStatusFailed
			s.store.SaveSession(sess)
		}
	} else {
		// conversation 还在执行中
		if sess.Status != session.SessionStatusPending {
			sess.Status = session.SessionStatusPending
			s.store.SaveSession(sess)
		}
	}
}
