// Package server 提供 HTTP API 服务。
package server

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// SessionListItem Session 列表项。
type SessionListItem struct {
	ID          string    `json:"id"`
	UserRequest string    `json:"user_request"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Possessed   bool      `json:"possessed"`
}

// ListSessionsResponse 获取所有 Session 列表的响应。
type ListSessionsResponse struct {
	Sessions []SessionListItem `json:"sessions"`
}

// ListSessions 获取所有 Session 列表（GET /sessions）。
func (s *Server) ListSessions(c echo.Context) error {
	// 获取所有 Session。
	allSessions := s.store.ListSessions()

	// 构建响应。
	sessions := make([]SessionListItem, len(allSessions))
	for i, sess := range allSessions {
		sessions[i] = SessionListItem{
			ID:          string(sess.ID),
			UserRequest: sess.UserRequest,
			Status:      string(sess.Status),
			CreatedAt:   sess.CreatedAt,
			UpdatedAt:   sess.UpdatedAt,
			Possessed:   sess.Possessed,
		}
	}

	return c.JSON(http.StatusOK, ListSessionsResponse{
		Sessions: sessions,
	})
}

