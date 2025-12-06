// Package server 提供 HTTP API 服务。
package server

import (
	"fmt"
	"net/http"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// InfoListItem Info 列表项。
type InfoListItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Class       string `json:"class"`
}

// ListInfosResponse 获取所有 Info 列表的响应。
type ListInfosResponse struct {
	Infos []InfoListItem `json:"infos"`
}

// ListInfos 获取 Session 的所有 Info 列表（GET /sessions/{id}/infos）。
func (s *Server) ListInfos(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))

	// 验证 Session 存在。
	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("session %s not found", sessionID)})
	}

	// 获取所有 Info。
	registry := agent.GetRegistry(sess.Engine)
	allInfos := registry.ListAllInfo()

	// 构建响应。
	infos := make([]InfoListItem, 0, len(allInfos))
	for id, info := range allInfos {
		infos = append(infos, InfoListItem{
			ID:          string(id),
			Name:        info.Name(),
			Description: info.Description(),
			Class:       info.Class(),
		})
	}

	return c.JSON(http.StatusOK, ListInfosResponse{
		Infos: infos,
	})
}

