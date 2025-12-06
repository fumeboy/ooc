// Package server 提供 HTTP API 服务。
// 功能：
//   - 提供 REST 接口：Session CRUD、Conversation 操作、Info 查询。
//   - 把 agent 与 session 能力封装成安全的外部 API。
//
// 使用 echo 框架开发。
package server

import (
	"ooc/internal/client/llm"
	"ooc/internal/session"
	"ooc/internal/utils/config"

	"github.com/labstack/echo/v4"
)

// Server HTTP 服务器。
type Server struct {
	store     session.Store
	llmClient llm.Client
	config    *config.Config
}

// NewServer 创建 HTTP 服务器。
func NewServer(store session.Store, llmClient llm.Client, cfg *config.Config) *Server {
	return &Server{
		store:     store,
		llmClient: llmClient,
		config:    cfg,
	}
}

// RegisterRoutes 注册 HTTP 路由（使用 echo 框架）。
func (s *Server) RegisterRoutes(e *echo.Echo) {
	// API 路由组。
	api := e.Group("/api")

	api.POST("/sessions", s.CreateSession)
	api.GET("/sessions", s.ListSessions)
	api.GET("/sessions/:id", s.GetSession)
	api.POST("/sessions/:id/talk", s.Talk)
	api.POST("/sessions/:id/answer", s.Answer)
	api.GET("/sessions/:id/info/:info_id", s.GetInfo)
	api.GET("/sessions/:id/infos", s.ListInfos)
	api.GET("/sessions/:id/conversations", s.ListConversations)
	api.GET("/sessions/:id/conversations/:conversation_id", s.GetConversation)

	// 附身功能相关路由
	api.POST("/sessions/:id/possess", s.SetPossess)
	api.GET("/sessions/:id/waiting_manual_conversations", s.GetWaitingManualConversations)
	api.POST("/sessions/:id/manual_think", s.RespondManualThink)

	// 配置信息路由
	api.GET("/conf", s.GetConfig)
}
