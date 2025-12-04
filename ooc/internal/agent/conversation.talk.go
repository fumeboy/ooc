// Package agent 的 conversation.talk.go 处理 Talk 特殊方法。
package agent

import (
	"fmt"

	"ooc/ooc/internal/client/llm"
)

// handleTalk 处理 Talk 方法：与其他信息对象对话。
func (e *ConversationEngine) handleTalk(conv *ConversationState, resp *llm.Response) (string, error) {
	// 从参数或 References 中获取目标对象 ID。
	var targetID InfoID
	if resp.Parameters != nil {
		if id, ok := resp.Parameters["target_id"].(string); ok {
			targetID = InfoID(id)
		} else if name, ok := resp.Parameters["target_name"].(string); ok {
			// 通过名称查找。
			targetID = e.findInfoByName(name)
		}
	}

	// 如果没找到，尝试从 References 中获取第一个。
	if targetID == "" && len(conv.References) > 0 {
		targetID = conv.References[0]
	}

	if targetID == "" {
		return "", fmt.Errorf("target info not found for Talk")
	}

	// 验证目标对象存在。
	_, ok := e.registry.GetInfo(targetID)
	if !ok {
		return "", fmt.Errorf("target info %s not found", targetID)
	}

	// 创建新的 Conversation 与目标对象对话。
	talkContent := resp.Content
	if talkContent == "" {
		talkContent = "Talk with me"
	}

	newConv := &ConversationState{
		From:       conv.To, // 当前对话的 To 作为新对话的 From
		To:         targetID,
		Content:    talkContent,
		References: conv.References,
	}

	newConvID, err := e.registry.RegisterConversation(newConv)
	if err != nil {
		return "", fmt.Errorf("register talk conversation failed: %w", err)
	}

	// 执行新对话。
	_, err = e.ThinkLoop(newConvID)
	if err != nil {
		return "", fmt.Errorf("talk failed: %w", err)
	}

	// 将新对话的 ID 添加到当前对话的 References。
	conv.References = append(conv.References, InfoID(newConvID))

	// 继续当前对话的思考循环。
	return e.Think(conv.ID)
}
