// Package server 提供 HTTP API 服务。
package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"ooc/internal/agent"
	"ooc/internal/session"

	"github.com/labstack/echo/v4"
)

// ManualThinkRequestResponse ManualThinkRequest 的响应格式。
type ManualThinkRequestResponse struct {
	ConversationID string          `json:"conversation_id"`
	Prompt         string          `json:"prompt,omitempty"`
	Tools          []string        `json:"tools,omitempty"`
	LLMMethod      string          `json:"llm_method,omitempty"`
	LLMParams      json.RawMessage `json:"llm_params,omitempty"`
}

// ConversationResponse 获取 Conversation 的响应。
type ConversationResponse struct {
	ID                        string                      `json:"id"`
	From                      string                      `json:"from"`
	To                        string                      `json:"to"`
	Title                     string                      `json:"title,omitempty"`
	Desc                      string                      `json:"desc,omitempty"`
	Request                   CommonParamsResponse        `json:"request"`
	Response                  CommonParamsResponse        `json:"response"`
	Questions                 []QuestionResponse          `json:"questions"`
	Activities                []ActivityResponse          `json:"activities"`
	Status                    string                      `json:"status"`
	Error                     string                      `json:"error,omitempty"`                        // 错误信息（当 Status 为 error 时）
	Mode                      string                      `json:"mode,omitempty"`                         // 对话执行模式（manual/hosted/semi_hosted）
	WaitingManualThinkRequest *ManualThinkRequestResponse `json:"waiting_manual_think_request,omitempty"` // 等待手动思考的请求（当 Status 为 waiting_manual_think 时）
	UpdatedAt                 string                      `json:"updated_at"`                             // 最后更新时间（ISO 8601 格式）
}

// CommonParamsResponse CommonParams 的响应格式。
type CommonParamsResponse struct {
	Title      string            `json:"title,omitempty"`
	Content    string            `json:"content,omitempty"`
	References map[string]string `json:"references,omitempty"`
}

// QuestionResponse Question 的响应格式。
type QuestionResponse struct {
	ID       int64                `json:"id"`
	Question CommonParamsResponse `json:"question"`
	Answer   CommonParamsResponse `json:"answer"`
}

// ActivityResponse Activity 的响应格式。
type ActivityResponse struct {
	Typ string `json:"typ"` // talk / act / ask / focus

	// when typ is talk/focus
	ConversationID string `json:"conversation_id,omitempty"`

	// when typ is act
	Object   string               `json:"object,omitempty"`
	Method   string               `json:"method,omitempty"`
	Request  json.RawMessage      `json:"request,omitempty"`
	Response CommonParamsResponse `json:"response,omitempty"`

	// when typ is ask
	QuestionID int64 `json:"question_id,omitempty"`
}

// GetConversation 获取 Conversation 详细信息（GET /sessions/{id}/conversations/{conversation_id}）。
func (s *Server) GetConversation(c echo.Context) error {
	sessionID := session.SessionID(c.Param("id"))
	conversationID := agent.ConversationID(c.Param("conversation_id"))

	// 验证 Session 存在。
	sess, ok := s.store.GetSession(sessionID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("session %s not found", sessionID)})
	}

	// 获取 Conversation。
	registry := agent.GetRegistry(sess.Engine)
	conv, ok := registry.GetConversation(conversationID)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("conversation %s not found", conversationID)})
	}

	// 构建响应。
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

	activities := make([]ActivityResponse, len(conv.Activities))
	for i, a := range conv.Activities {
		actionResp := ActivityResponse{
			Typ: a.Typ,
		}
		if a.Typ == "talk" || a.Typ == "focus" {
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
		} else if a.Typ == "ask" {
			actionResp.QuestionID = a.QuestionID
		}
		activities[i] = actionResp
	}

	mode := string(conv.Mode)
	if mode == "" {
		mode = string(agent.ConversationModeManual)
	}

	// 格式化 UpdatedAt 为 ISO 8601 格式
	updatedAtStr := conv.UpdatedAt.Format(time.RFC3339)
	if conv.UpdatedAt.IsZero() {
		// 如果 UpdatedAt 为零值，使用当前时间
		updatedAtStr = time.Now().Format(time.RFC3339)
	}

	response := ConversationResponse{
		ID:    string(conv.IDValue),
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
		Questions:  questions,
		Activities: activities,
		Status:     conv.Status,
		Error:      conv.Error,
		Mode:       mode,
		UpdatedAt:  updatedAtStr,
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

	return c.JSON(http.StatusOK, response)
}
