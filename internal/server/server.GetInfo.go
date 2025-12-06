// Package server 提供 HTTP API 服务。
package server

import (
	"fmt"
	"net/http"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// InfoResponse 获取 Info 的响应。
type InfoResponse struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Prompt      string   `json:"prompt,omitempty"`  // 仅在 detail=true 时返回
	Methods     []string `json:"methods,omitempty"` // 仅在 detail=true 时返回
}

// GetInfo 获取 Info 信息（GET /sessions/{id}/info/{info_id}）。
// 查询参数：
//   - detail: 是否返回详细信息（prompt 和 methods），默认为 false
func (s *Server) GetInfo(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))
	infoID := agent.InfoID(c.Param("info_id"))

	// 获取查询参数。
	detail := c.QueryParam("detail") == "true"

	// 验证 Session 存在。
	session, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("session %s not found", sessionID)})
	}

	// 获取 Info。
	info, ok := agent.GetRegistry(session.Engine).GetInfo(infoID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("info %s not found", infoID)})
	}

	// 构建响应。
	response := InfoResponse{
		ID:          string(infoID),
		Name:        info.Name(),
		Description: info.Description(),
	}

	// 只有在需要详情时才获取 prompt 和 methods。
	if detail {
		response.Prompt = info.Prompt()
		methods := info.Methods()
		methodNames := make([]string, len(methods))
		for i, m := range methods {
			methodNames[i] = m.Name()
		}
		response.Methods = methodNames
	}

	return c.JSON(http.StatusOK, response)
}
