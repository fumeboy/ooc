// Package agent 的 conversation.go 实现对话思考循环。
// 功能：
//   - 实现 Think 方法：AssembleContext → LLM Call → ApplyResult。
//   - 实现 ThinkLoop 方法：循环思考直到完成或等待用户。
//   - 处理 Respond/Talk/Ask/Focus 等特殊方法。
package agent

import (
	"encoding/json"
	"fmt"

	"ooc/ooc/internal/client/llm"
)

// MethodExecutor 方法执行器接口（用于解耦 module 依赖）。
// 现在通过 methodName 获取 MethodI 实例，然后调用其 Execute 方法。
type MethodExecutor interface {
	ExecuteMethod(methodName string, action *ActionState) (string, []InfoID, error)
}

// ConversationEngine 对话引擎。
// 同时支持普通 Conversation 和 Action 模式（Action 是特殊化的 Conversation）。
type ConversationEngine struct {
	registry *Registry
	llm      llm.Client
	executor MethodExecutor

	// Action 模式相关字段（当 Conversation 是 Action 时使用）。
	actionMethod MethodI      // Action 要执行的方法
	actionState  *ActionState // Action 状态
}

// NewConversationEngine 创建对话引擎。
func NewConversationEngine(reg *Registry, client llm.Client, exec MethodExecutor) *ConversationEngine {
	return &ConversationEngine{
		registry: reg,
		llm:      client,
		executor: exec,
	}
}

// Think 执行一次思考。
func (e *ConversationEngine) Think(convID ConversationID) (string, error) {
	conv, ok := e.registry.GetConversation(convID)
	if !ok {
		return "", fmt.Errorf("conversation %s not found", convID)
	}

	// 1. AssembleContext：构造 LLM 输入。
	req := e.assembleContext(conv)

	// 2. LLM Call。
	resp, err := e.llm.Call(req)
	if err != nil {
		return "", fmt.Errorf("llm call failed: %w", err)
	}

	// 3. ApplyResult：处理 LLM 响应。
	return e.applyResult(conv, resp)
}

// ThinkLoop 执行思考循环，直到对话完成或遇到 Ask。
func (e *ConversationEngine) ThinkLoop(convID ConversationID) (string, error) {
	for {
		conv, ok := e.registry.GetConversation(convID)
		if !ok {
			return "", fmt.Errorf("conversation %s not found", convID)
		}

		// 如果对话已完成或等待用户，直接返回。
		if conv.Status == "completed" {
			// 查找最后一次 Respond 的结果。
			return e.getLastResult(convID)
		}
		if conv.Status == "waiting_for_user" {
			// 返回 Ask 消息。
			if conv.Metadata != nil {
				if msg, ok := conv.Metadata["ask_message"]; ok {
					return msg, nil
				}
			}
			return "", fmt.Errorf("waiting for user but no ask message")
		}

		// 执行一次思考。
		result, err := e.Think(convID)
		if err != nil {
			return "", err
		}

		// 如果返回结果且状态为 completed，结束循环。
		updated, _ := e.registry.GetConversation(convID)
		if updated.Status == "completed" {
			// 保存结果到 Metadata。
			if updated.Metadata == nil {
				updated.Metadata = make(map[string]string)
			}
			updated.Metadata["last_result"] = result
			return result, nil
		}
		if updated.Status == "waiting_for_user" {
			return result, nil
		}

		// 继续循环。
	}
}

// getLastResult 获取对话的最后结果。
func (e *ConversationEngine) getLastResult(convID ConversationID) (string, error) {
	conv, _ := e.registry.GetConversation(convID)
	if conv.Metadata != nil {
		if result, ok := conv.Metadata["last_result"]; ok {
			return result, nil
		}
	}
	return "", fmt.Errorf("no result found")
}

// assembleContext 组装对话上下文。
// 如果是 Action 模式，会包含 Method 的 Document 和 Parameters（meta.md 65）。
func (e *ConversationEngine) assembleContext(conv *ConversationState) *llm.Request {
	toInfo, ok := e.registry.GetInfo(conv.To)
	if !ok {
		return &llm.Request{Prompt: "Error: target info not found"}
	}

	// 构建 prompt：包含 To 的 Prompt、Content。
	prompt := fmt.Sprintf("You are %s. %s\n\nRequest: %s",
		toInfo.Name(), toInfo.Prompt(), conv.Content)

	// 如果是 Action 模式，添加 Method 的 Document 和 Parameters（meta.md 65：Action 唯一的区别）。
	if e.actionMethod != nil {
		prompt += fmt.Sprintf(`

You need to execute method "%s" on object "%s".

Method Document: %s
Method Parameters Schema: %s`,
			e.actionMethod.Name(),
			toInfo.Name(),
			e.actionMethod.Document(),
			e.actionMethod.Parameters())
	}

	// 添加 References 描述（meta.md 41：Request.References）。
	if len(conv.References) > 0 {
		prompt += "\n\nAvailable References (you can Talk with them):"
		for _, refID := range conv.References {
			refInfo, ok := e.registry.GetInfo(refID)
			if ok {
				prompt += fmt.Sprintf("\n- %s: %s", refInfo.Name(), refInfo.Description())
			}
		}
	}

	// 添加 Actions 历史（meta.md 42：Actions）。
	if len(conv.ActionIDs) > 0 {
		prompt += "\n\nPrevious Actions:"
		for _, actionID := range conv.ActionIDs {
			action, ok := e.registry.GetAction(actionID)
			if ok {
				status := "completed"
				if action.Status != "" {
					status = action.Status
				}
				prompt += fmt.Sprintf("\n- %s.%s: %s (status: %s)", action.TargetInfo, action.MethodName, action.Response, status)
			}
		}
	}

	// 添加可执行方法列表（只包含 name 和 description，meta.md 48）。
	tools := []llm.Tool{}
	methods := toInfo.Methods()
	for _, method := range methods {
		tools = append(tools, llm.Tool{
			Name:        method.Name(),
			Description: method.Description(),
		})
	}

	tools = append(tools, []llm.Tool{
		{Name: "Respond", Description: "返回对话结果"},
		{Name: "Talk", Description: "与其他信息对象对话（可用于 References 中的对象）"},
		{Name: "Ask", Description: "向用户询问问题"},
		{Name: "Focus", Description: "创建子对话聚焦子问题"},
	}...)

	return &llm.Request{
		Prompt: prompt,
		Tools:  tools,
	}
}

// applyResult 应用 LLM 响应结果。
func (e *ConversationEngine) applyResult(conv *ConversationState, resp *llm.Response) (string, error) {
	switch resp.Method {
	case "Respond":
		// 对话结束，返回结果（Action 和普通 Conversation 都一样）。
		conv.Status = "completed"
		return resp.Content, nil

	case "Talk":
		// 与其他对象对话。
		return e.handleTalk(conv, resp)

	case "Ask":
		// 向用户询问。
		return e.handleAsk(conv, resp)

	case "Focus":
		// 创建子对话。
		return e.handleFocus(conv, resp)

	default:
		// 执行具体方法：创建 Action 或直接执行（如果是 Action 模式且 method 匹配）。
		return e.executeMethod(conv, resp)
	}
}

// findInfoByName 通过名称查找 Info ID。
func (e *ConversationEngine) findInfoByName(name string) InfoID {
	// 遍历所有 Info 查找匹配的名称。
	// 注意：这里简化实现，实际应该通过 Registry 提供查询接口。
	// 暂时返回空，由调用方处理。
	return ""
}

// executeMethod 执行具体方法。
func (e *ConversationEngine) executeMethod(conv *ConversationState, resp *llm.Response) (string, error) {
	if e.executor == nil {
		return "", fmt.Errorf("executor not set")
	}

	// 如果是 Action 模式，且 LLM 返回的 method 正是 Action 要执行的 method，则直接执行。
	if e.actionMethod != nil && e.actionState != nil && resp.Method == e.actionMethod.Name() {
		return e.executeActionMethod(conv, resp)
	}

	// 查找方法对应的 executor（通过命名约定：module.method）。
	toInfo, ok := e.registry.GetInfo(conv.To)
	if !ok {
		return "", fmt.Errorf("target info not found")
	}

	// 查找方法。
	var targetMethod MethodI
	methods := toInfo.Methods()
	for _, method := range methods {
		if method.Name() == resp.Method {
			targetMethod = method
			break
		}
	}
	if targetMethod == nil {
		return "", fmt.Errorf("method %s not found", resp.Method)
	}

	// 创建 Action 并执行（meta.md 56-61：Action 由四个参数构造）。
	action := &ActionState{
		Conversation:  conv.ID,         // From: 从哪个 Conversation 中发起的 Action
		TargetInfo:    conv.To,         // Object: 要执行 Method 的可交互信息对象
		MethodName:    resp.Method,     // Method: 要执行的 Method
		Request:       resp.Content,    // Request: 自然语言描述的执行请求
		References:    conv.References, // References: 可能和这次方法执行有关的可交互信息对象列表
		ParameterJSON: "",              // 由 Action 引擎解析。
	}

	// 创建新的 ConversationEngine 实例用于 Action（设置 Action 模式）。
	actionEngine := &ConversationEngine{
		registry:     e.registry,
		llm:          e.llm,
		executor:     e.executor,
		actionMethod: targetMethod,
		actionState:  action,
	}

	// 将 ActionState 转换为 ConversationState。
	actionConv := &ConversationState{
		ID:         ConversationID(action.ID),
		From:       action.TargetInfo,
		To:         action.TargetInfo,
		Content:    action.Request,
		References: action.References,
		ActionIDs:  []ActionID{action.ID},
		Status:     action.Status,
	}

	// 注册 Conversation。
	actionConvID, err := e.registry.RegisterConversation(actionConv)
	if err != nil {
		return "", fmt.Errorf("register conversation failed: %w", err)
	}

	// 使用 Action 模式的 ThinkLoop 执行。
	_, err = actionEngine.ThinkLoop(actionConvID)
	if err != nil {
		return "", fmt.Errorf("execute method failed: %w", err)
	}

	// 同步 action 的状态。
	action.Status = actionConv.Status
	action.References = actionConv.References

	// 将 Action 附加到 Conversation。
	if err := e.registry.AttachAction(conv.ID, action); err != nil {
		return "", fmt.Errorf("attach action failed: %w", err)
	}

	// 继续思考循环（递归调用 Think）。
	return e.Think(conv.ID)
}

// executeActionMethod 执行 Action 方法（当 Respond 或 method name 匹配时调用）。
func (e *ConversationEngine) executeActionMethod(conv *ConversationState, resp *llm.Response) (string, error) {
	if e.executor == nil {
		return "", fmt.Errorf("executor not set")
	}

	if e.actionMethod == nil || e.actionState == nil {
		return "", fmt.Errorf("action method or state not set")
	}

	// 从响应中提取参数 JSON。
	var paramJSON string
	if resp.Parameters != nil {
		data, err := json.Marshal(resp.Parameters)
		if err == nil {
			paramJSON = string(data)
		}
	}
	e.actionState.ParameterJSON = paramJSON

	// 直接调用方法的 Execute（actionMethod 已经实现了 MethodI.Execute）。
	message, refs, err := e.actionMethod.Execute(e.actionState)
	if err != nil {
		e.actionState.Status = "failed"
		e.actionState.ErrorMessage = err.Error()
		return "", fmt.Errorf("execute failed: %w", err)
	}

	e.actionState.Status = "completed"
	e.actionState.Response = message
	e.actionState.References = refs

	// 将 Action 附加到 Conversation。
	if err := e.registry.AttachAction(conv.ID, e.actionState); err != nil {
		return "", fmt.Errorf("attach action failed: %w", err)
	}

	// 更新 Conversation 状态。
	conv.Status = "completed"
	return message, nil
}
