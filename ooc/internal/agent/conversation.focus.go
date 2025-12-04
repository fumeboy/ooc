// Package agent 的 conversation.focus.go 处理 Focus 特殊方法。
package agent

import (
	"fmt"

	"ooc/ooc/internal/client/llm"
)

// handleFocus 处理 Focus 方法：创建子对话聚焦子问题。
func (e *ConversationEngine) handleFocus(conv *ConversationState, resp *llm.Response) (string, error) {
	// 提取子问题内容。
	focusContent := resp.Content
	if focusContent == "" {
		if msg, ok := resp.Parameters["content"].(string); ok {
			focusContent = msg
		} else {
			return "", fmt.Errorf("focus content is empty")
		}
	}

	// 创建子对话：From 和 To 都是自己。
	focusConv := &ConversationState{
		From:       conv.To, // 自己
		To:         conv.To, // 自己
		Content:    focusContent,
		References: conv.References, // 继承父对话的 References
	}

	// 添加父对话 ID 到 References。
	focusConv.References = append(focusConv.References, InfoID(conv.ID))

	focusConvID, err := e.registry.RegisterConversation(focusConv)
	if err != nil {
		return "", fmt.Errorf("register focus conversation failed: %w", err)
	}

	// 执行子对话。
	_, err = e.ThinkLoop(focusConvID)
	if err != nil {
		return "", fmt.Errorf("focus talk failed: %w", err)
	}

	// 将子对话 ID 添加到当前对话的 References。
	conv.References = append(conv.References, InfoID(focusConvID))

	// 继续当前对话的思考循环。
	return e.Think(conv.ID)
}
