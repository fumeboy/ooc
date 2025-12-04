// Package agent 的 conversation.ask.go 处理 Ask 特殊方法。
package agent

import (
	"fmt"
	"time"

	"ooc/ooc/internal/client/llm"
)

// handleAsk 处理 Ask 方法：向用户询问问题。
func (e *ConversationEngine) handleAsk(conv *ConversationState, resp *llm.Response) (string, error) {
	// 设置状态为等待用户回答。
	conv.Status = "waiting_for_user"

	// 记录 Ask 消息到 Metadata。
	if conv.Metadata == nil {
		conv.Metadata = make(map[string]string)
	}
	conv.Metadata["ask_message"] = resp.Content
	conv.Metadata["ask_timestamp"] = fmt.Sprintf("%d", time.Now().Unix())

	// 返回问题内容，等待用户回答。
	return resp.Content, nil
}
