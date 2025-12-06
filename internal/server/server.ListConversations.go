// Package server 提供 HTTP API 服务。
package server

import (
	"net/http"
	"time"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// ListConversationsResponse 获取 Conversation 列表的响应。
type ListConversationsResponse struct {
	Conversations []ConversationResponse `json:"conversations"`
}

// ListConversations 获取 Session 的所有 conversation 列表（GET /sessions/{id}/conversations）。
func (s *Server) ListConversations(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	engine := sess.Engine
	if engine == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "engine not found"})
	}

	// 获取所有 conversation
	conversations := engine.GetConversations()

	// 转换为响应格式
	conversationResponses := make([]ConversationResponse, len(conversations))
	for i, conv := range conversations {
		conversationResponses[i] = s.conversationToResponse(conv)
	}

	return c.JSON(http.StatusOK, ListConversationsResponse{
		Conversations: conversationResponses,
	})
}

// conversationToResponse 将 Conversation 转换为响应格式（复用 GetConversation 的逻辑）
func (s *Server) conversationToResponse(conv *agent.Conversation) ConversationResponse {
	questions := make([]QuestionResponse, len(conv.Questions))
	for i, q := range conv.Questions {
		questions[i] = QuestionResponse{
			ID: q.Id,
			Question: CommonParamsResponse{
				Title:      q.Question.Title,
				Content:    q.Question.Content,
				References: q.Question.References,
			},
			Answer: CommonParamsResponse{
				Title:      q.Answer.Title,
				Content:    q.Answer.Content,
				References: q.Answer.References,
			},
		}
	}

	actions := make([]ActionResponse, len(conv.Actions))
	for i, a := range conv.Actions {
		actionResp := ActionResponse{
			Typ: a.Typ,
		}
		if a.Typ == "talk" {
			actionResp.ConversationID = string(a.ConversationID)
		} else if a.Typ == "act" {
			actionResp.Object = string(a.Object)
			actionResp.Method = a.Method
			actionResp.Request = a.Request
			actionResp.Response = CommonParamsResponse{
				Title:      a.Response.Title,
				Content:    a.Response.Content,
				References: a.Response.References,
			}
		}
		actions[i] = actionResp
	}

	mode := string(conv.Mode)
	if mode == "" {
		mode = string(agent.ConversationModeHosted)
	}

	// 格式化 UpdatedAt 为 ISO 8601 格式
	updatedAtStr := conv.UpdatedAt.Format(time.RFC3339)
	if conv.UpdatedAt.IsZero() {
		// 如果 UpdatedAt 为零值，使用当前时间
		updatedAtStr = time.Now().Format(time.RFC3339)
	}

	response := ConversationResponse{
		ID:    string(conv.ID),
		From:  string(conv.From),
		To:    string(conv.To),
		Title: conv.Title,
		Desc:  conv.Desc,
		Request: CommonParamsResponse{
			Title:      conv.Request.Title,
			Content:    conv.Request.Content,
			References: conv.Request.References,
		},
		Response: CommonParamsResponse{
			Title:      conv.Response.Title,
			Content:    conv.Response.Content,
			References: conv.Response.References,
		},
		Questions: questions,
		Actions:   actions,
		Status:    conv.Status,
		Error:     conv.Error,
		Mode:      mode,
		UpdatedAt: updatedAtStr,
	}

	// 如果状态是 waiting_manual_think，包含 ManualThinkRequest
	if conv.Status == agent.StatusWaitingManualThink && conv.WaitingManualThinkRequest != nil {
		response.WaitingManualThinkRequest = &ManualThinkRequestResponse{
			ConversationID: string(conv.WaitingManualThinkRequest.ConversationID),
			Prompt:         conv.WaitingManualThinkRequest.Prompt,
			Tools:          conv.WaitingManualThinkRequest.Tools,
			LLMMethod:      conv.WaitingManualThinkRequest.LLMMethod,
			LLMParams:      conv.WaitingManualThinkRequest.LLMParams,
		}
	}

	return response
}
