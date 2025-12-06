// Package server 提供 HTTP API 服务。
package server

import (
	"fmt"
	"net/http"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// AnswerRequest 用户回答 Ask 的请求。
type AnswerRequest struct {
	ConversationID string            `json:"conversation_id"` // 对话 ID（多轮交互下需要指定）
	QuestionId     int64             `json:"question_id"`
	Answer         string            `json:"answer"`
	References     map[string]string `json:"references,omitempty"` // key = info id, value = reason
}

// Answer 用户回答 Ask（POST /sessions/{id}/answer）。
func (s *Server) Answer(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	engine := sess.Engine

	// 解析请求。
	var req AnswerRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
	}

	if req.ConversationID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "conversation_id is required"})
	}

	// 获取 Conversation。
	convID := agent.ConversationID(req.ConversationID)
	conv, ok := agent.GetRegistry(engine).GetConversation(convID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "conversation not found"})
	}

	// 验证状态。
	if conv.Status != agent.StatusWaitingAnswer {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "conversation is not waiting for user"})
	}

	// 记录用户响应事件。
	s.store.AppendEvent(sessionID, &session.Event{
		Type:    session.EventRespondSent,
		Payload: req.Answer,
	})

	engine.Answer(convID, req.QuestionId, agent.CommonParams{
		Content:    req.Answer,
		References: req.References,
	})

	return c.String(http.StatusOK, "")
}
