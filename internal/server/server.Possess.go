// Package server 提供 HTTP API 服务。
package server

import (
	"encoding/json"
	"fmt"
	"net/http"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// SetPossessRequest 设置附身状态的请求。
type SetPossessRequest struct {
	Possess bool `json:"possess"`
}

// SetPossessResponse 设置附身状态的响应。
type SetPossessResponse struct {
	Possessed bool `json:"possessed"`
}

// SetPossess 设置附身状态（POST /sessions/{id}/possess）。
func (s *Server) SetPossess(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	var req SetPossessRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
	}

	engine := sess.Engine
	if engine == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "engine not found"})
	}

	engine.Possessed = req.Possess
	s.store.SaveSession(sess)

	return c.JSON(http.StatusOK, SetPossessResponse{
		Possessed: req.Possess,
	})
}

// GetWaitingManualConversationsResponse 获取等待手动思考的 conversations 的响应。
type GetWaitingManualConversationsResponse struct {
	Conversations []ConversationResponse `json:"conversations"`
}

// GetWaitingManualConversations 获取等待手动思考的 conversations（GET /sessions/{id}/waiting_manual_conversations）。
// 遍历所有 conversation，找出其中状态为 StatusWaitingManualThink 的
func (s *Server) GetWaitingManualConversations(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	engine := sess.Engine
	if engine == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "engine not found"})
	}

	// 遍历所有 conversation，找出状态为 StatusWaitingManualThink 的
	conversations := engine.GetConversations()
	items := make([]ConversationResponse, 0)

	for _, conv := range conversations {
		if conv.Status == agent.StatusWaitingManualThink {
			items = append(items, s.conversationToResponse(conv))
		}
	}

	return c.JSON(http.StatusOK, GetWaitingManualConversationsResponse{
		Conversations: items,
	})
}

// ManualThinkRequest 用户回复手动思考的请求。
type ManualThinkRequest struct {
	ConversationID string          `json:"conversation_id"` // 对话 ID
	Method         string          `json:"method"`          // 方法名
	Parameters     json.RawMessage `json:"parameters"`      // 参数（JSON 格式）
}

// RespondManualThink 用户回复手动思考（POST /sessions/{id}/manual_think）。
// 用于处理 StatusWaitingManualThink 状态的 conversation
func (s *Server) RespondManualThink(c echo.Context) error {
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
	var req ManualThinkRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
	}

	if req.ConversationID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "conversation_id is required"})
	}

	if req.Method == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "method is required"})
	}

	// 获取 Conversation。
	convID := agent.ConversationID(req.ConversationID)
	conv, ok := agent.GetRegistry(engine).GetConversation(convID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "conversation not found"})
	}

	// 验证状态。
	if conv.Status != agent.StatusWaitingManualThink {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "conversation is not waiting for manual think"})
	}

	// 记录用户响应事件。
	s.store.AppendEvent(sessionID, &session.Event{
		Type:    session.EventRespondSent,
		Payload: req.Method,
	})

	// 恢复手动思考
	if err := engine.ResumeManualThink(convID, req.Method, req.Parameters); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("resume manual think failed: %v", err)})
	}

	s.store.SaveSession(sess)

	return c.String(http.StatusOK, "")
}
