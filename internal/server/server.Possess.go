// Package server 提供 HTTP API 服务。
package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// StartPossessRequest 开始附身的请求。
type StartPossessRequest struct {
	Possess bool `json:"possess"`
}

// StartPossessResponse 开始附身的响应。
type StartPossessResponse struct {
	Possessed bool `json:"possessed"`
}

// StartPossess 开始或停止附身（POST /sessions/{id}/possess）。
func (s *Server) StartPossess(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	var req StartPossessRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
	}

	// 设置附身状态。
	sess.Engine.SetPossess(req.Possess, func(req *agent.PossessRequest) {
		// 回调函数：将附身请求保存到 Session
		sess.PossessRequest = req
		s.store.SaveSession(sess)
	})
	sess.Possessed = req.Possess
	sess.PossessRequest = nil
	s.store.SaveSession(sess)

	return c.JSON(http.StatusOK, StartPossessResponse{
		Possessed: req.Possess,
	})
}

// GetPossessRequestResponse 获取附身请求的响应。
type GetPossessRequestResponse struct {
	HasRequest bool            `json:"has_request"`
	Prompt     string          `json:"prompt,omitempty"`
	Tools      []string        `json:"tools,omitempty"`
	LLMMethod  string          `json:"llm_method,omitempty"` // LLM 输出的方法名
	LLMParams  json.RawMessage `json:"llm_params,omitempty"` // LLM 输出的参数
}

// GetPossessRequest 获取当前的附身请求（GET /sessions/{id}/possess/request）。
func (s *Server) GetPossessRequest(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	if !sess.Possessed {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "session is not possessed"})
	}

	if sess.PossessRequest == nil {
		return c.JSON(http.StatusOK, GetPossessRequestResponse{
			HasRequest: false,
		})
	}

	return c.JSON(http.StatusOK, GetPossessRequestResponse{
		HasRequest: true,
		Prompt:     sess.PossessRequest.Prompt,
		Tools:      sess.PossessRequest.Tools,
		LLMMethod:  sess.PossessRequest.LLMMethod,
		LLMParams:  sess.PossessRequest.LLMParams,
	})
}

// RespondPossessRequest 回复附身请求（POST /sessions/{id}/possess/respond）。
type RespondPossessRequest struct {
	Method     string          `json:"method"`
	Parameters json.RawMessage `json:"parameters"`
	Error      string          `json:"error,omitempty"`
}

// RespondPossess 回复附身请求。
func (s *Server) RespondPossess(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "session not found"})
	}

	if !sess.Possessed {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "session is not possessed"})
	}

	if sess.PossessRequest == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "no possess request pending"})
	}

	var req RespondPossessRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
	}

	// 构建回复。
	var resp *agent.PossessResponse
	if req.Error != "" {
		resp = &agent.PossessResponse{
			Error: errors.New(req.Error),
		}
	} else {
		resp = &agent.PossessResponse{
			Method:     req.Method,
			Parameters: req.Parameters,
		}
	}

	// 保存 ConversationID（在清空 PossessRequest 之前）
	convID := sess.PossessRequest.ConversationID
	if convID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "conversation id not found in possess request"})
	}

	// 清空附身请求。
	sess.PossessRequest = nil
	sess.Status = session.SessionStatusPending
	s.store.SaveSession(sess)

	// 恢复思考循环
	if err := sess.Engine.ResumePossess(convID, resp); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("resume possess failed: %v", err)})
	}

	return c.String(http.StatusOK, "")
}
