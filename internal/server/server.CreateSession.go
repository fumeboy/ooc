// Package server 提供 HTTP API 服务。
package server

import (
	"fmt"
	"net/http"

	"ooc/internal/agent"
	"ooc/internal/module/notebook"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// CreateSessionRequest 创建 Session 的请求。
type CreateSessionRequest struct {
	UserRequest string   `json:"user_request"`
	References  []string `json:"references,omitempty"` // InfoID 列表
	Possess     bool     `json:"possess,omitempty"`    // 是否立即开启附身
}

// CreateSessionResponse 创建 Session 的响应。
type CreateSessionResponse struct {
	SessionID string `json:"session_id"`
	Status    string `json:"status"`
}

// CreateSession 创建新的 Session（POST /sessions）。
func (s *Server) CreateSession(c echo.Context) error {
	var req CreateSessionRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
	}

	if req.UserRequest == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "user_request is required"})
	}

	// 创建 Session。
	sess := &session.Session{
		UserRequest: req.UserRequest,
		Status:      session.SessionStatusPending,
	}
	sessionID, err := s.store.SaveSession(sess)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("create session failed: %v", err)})
	}

	// 记录事件。
	s.store.AppendEvent(sessionID, &session.Event{
		Type:    session.EventConversationStarted,
		Payload: req.UserRequest,
	})

	// 将 References 转换为 map[string]string（如果没有提供 reason，使用空字符串）。
	references := make(map[string]string)
	for _, refStr := range req.References {
		references[refStr] = "" // 初始创建时没有 reason
	}

	// 构建 agent
	engine := agent.New(s.llmClient)
	agent.GetModuleManager(engine).Register(notebook.NewModule())

	// 设置 Session 状态更新回调（当 root conversation 状态变化时更新 session 状态）
	engine.SetSessionStatusCallback(func(status string) {
		switch status {
		case "failed":
			sess.Status = session.SessionStatusFailed
		case "waiting_possess":
			sess.Status = session.SessionStatusWaitingPossess
		}
		s.store.SaveSession(sess)
	})

	sess.Engine = engine

	// 如果请求中指定了立即附身，则开启附身
	if req.Possess {
		sess.Engine.SetPossess(true, func(req *agent.PossessRequest) {
			// 回调函数：将附身请求保存到 Session
			sess.PossessRequest = req
			s.store.SaveSession(sess)
		})
		sess.Possessed = true
	}

	// 创建 root conversation，如果提供了初始请求则立即发送
	engine.Run(agent.CommonParams{
		Content:    req.UserRequest,
		References: references,
	})
	s.store.SaveSession(sess)

	return c.JSON(http.StatusOK, CreateSessionResponse{
		SessionID: string(sessionID),
		Status:    "pending",
	})
}
