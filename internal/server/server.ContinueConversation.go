// Package server 提供 HTTP API 服务。
package server

import (
	"fmt"
	"net/http"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// ContinueConversationRequest 继续对话的请求。
type ContinueConversationRequest struct {
	Content    string            `json:"content"`
	Title      string            `json:"title,omitempty"`
	References map[string]string `json:"references,omitempty"` // key = info id, value = reason
}

// ContinueConversation 用户继续对话（POST /sessions/{id}/continue）。
func (s *Server) ContinueConversation(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	engine := sess.Engine
	if engine == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "engine not found"})
	}

	// 解析请求。
	var req ContinueConversationRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
	}

	if req.Content == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "content is required"})
	}

	// 记录事件。
	s.store.AppendEvent(sessionID, &session.Event{
		Type:    session.EventConversationStarted,
		Payload: req.Content,
	})

	// 继续对话
	go engine.Continue(agent.CommonParams{
		Title:      req.Title,
		Content:    req.Content,
		References: req.References,
	})

	s.store.SaveSession(sess)

	return c.String(http.StatusOK, "")
}
