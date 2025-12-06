// Package server 提供 HTTP API 服务。
package server

import (
	"fmt"
	"net/http"

	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// TalkRequest 用户发起 Talk 的请求。
type TalkRequest struct {
	TalkWith   string            `json:"talk_with"` // 要对话的信息对象 ID
	Title      string            `json:"title,omitempty"`
	Content    string            `json:"content"`
	References map[string]string `json:"references,omitempty"` // key = info id, value = reason
}

// Talk 用户发起 Talk（POST /sessions/{id}/talk）。
// 让 User 作为 Conversation 的 From 角色执行一次 MethodTalk
func (s *Server) Talk(c echo.Context) error {
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
	var req TalkRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
	}

	if req.Content == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "content is required"})
	}

	if req.TalkWith == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "talk_with is required"})
	}

	// 让 User 执行一次 Talk
	convID, err := engine.UserTalk(req.TalkWith, req.Title, req.Content, req.References)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("execute talk failed: %v", err)})
	}

	// 记录事件。
	s.store.AppendEvent(sessionID, &session.Event{
		Type:    session.EventConversationStarted,
		Payload: req.Content,
	})

	s.store.SaveSession(sess)

	// 返回创建的 conversation ID
	return c.JSON(http.StatusOK, map[string]string{
		"conversation_id": string(convID),
	})
}
