// Package agent 的 conversation.go 实现对话思考循环。
// 功能：
//   - 实现 Think 方法：AssembleContext → LLM Call → ApplyResult。
//   - 实现 ThinkLoop 方法：循环思考直到完成或等待用户。
//   - 处理 Respond/Talk/Ask/Focus 等特殊方法。
package agent

import (
	"encoding/json"
	"fmt"
	"sync"

	"ooc/internal/client/llm"
)

// PossessCallback 附身回调函数，用于将附身请求保存到 Session。
type PossessCallback func(req *PossessRequest)

type Engine struct {
	registry     *Registry
	llm          llm.Client
	executor     *ModuleManager
	maxLoopCount int

	conversations []*Conversation // 用户与系统的对话列表（From: User, To: System）
	mu            sync.Mutex      // 保护 conversations 的并发访问

	// 附身功能相关字段
	possessCallback PossessCallback // 附身回调函数，用于保存请求到 Session（nil 表示未附身）

	// Session 状态更新回调（当 conversation 状态变化时调用）
	sessionStatusCallback func(status string)
}

// PossessRequest 附身请求，等待用户回复。
type PossessRequest struct {
	ConversationID ConversationID  // 对话 ID
	Prompt         string          // 当前的 prompt
	Tools          []string        // 可用的工具列表
	LLMMethod      string          // LLM 输出的方法名
	LLMParams      json.RawMessage // LLM 输出的参数
}

// PossessResponse 用户对附身请求的回复。
type PossessResponse struct {
	Method     string          // 方法名
	Parameters json.RawMessage // 参数（JSON 格式）
	Error      error           // 如果用户选择返回错误
}

func New(client llm.Client) *Engine {
	var reg = &Registry{
		infos: make(map[InfoID]InfoI),
	}
	var m = &ModuleManager{
		registry:  reg,
		providers: make(map[string]ModuleProvider),
	}
	var e = &Engine{
		registry: reg,
		llm:      client,
		executor: m,
	}

	m.Register(&ModuleBase{e: e})
	return e
}

func GetRegistry(e *Engine) *Registry {
	return e.registry
}

// SetSessionStatusCallback 设置 Session 状态更新回调函数。
func (e *Engine) SetSessionStatusCallback(callback func(status string)) {
	e.sessionStatusCallback = callback
}

// updateSessionStatusOnError 更新 Session 状态为失败。
func (e *Engine) updateSessionStatusOnError() {
	if e.sessionStatusCallback != nil {
		e.sessionStatusCallback("failed")
	}
}

// SetPossess 设置附身状态。
func (e *Engine) SetPossess(possess bool, callback PossessCallback) {
	if possess {
		e.possessCallback = callback
	} else {
		e.possessCallback = nil
	}
}

// IsPossessed 检查是否处于附身状态。
func (e *Engine) IsPossessed() bool {
	return e.possessCallback != nil
}

func (e *Engine) Run(UserRequest CommonParams) {
	// 如果提供了初始请求，立即创建 conversation
	if UserRequest.Content != "" {
		e.Continue(UserRequest)
	}
}

// Continue 用户继续对话，创建新的 conversation（From: User, To: System）
func (e *Engine) Continue(userRequest CommonParams) {
	// 创建新的 conversation（From: User, To: System）
	conv := &Conversation{
		engine: e,
		From:   WrapInfoID("user", "User"),
		To:     WrapInfoID("system", "System"),
		Request: CommonParams{
			Title:      userRequest.Title,
			Content:    userRequest.Content,
			References: userRequest.References,
		},
	}

	_, _ = e.registry.RegisterConversation(conv)

	// 添加到 conversations 列表
	e.mu.Lock()
	e.conversations = append(e.conversations, conv)
	e.mu.Unlock()

	// 执行思考循环
	go e.ThinkLoop(conv)
}

// GetLastConversationID 获取最后一个 conversation 的 ID
func (e *Engine) GetLastConversationID() ConversationID {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.conversations) == 0 {
		return ""
	}
	return e.conversations[len(e.conversations)-1].ID
}

// GetConversations 获取所有 conversation 列表
func (e *Engine) GetConversations() []*Conversation {
	e.mu.Lock()
	defer e.mu.Unlock()
	result := make([]*Conversation, len(e.conversations))
	copy(result, e.conversations)
	return result
}

func (e *Engine) Answer(convID ConversationID, QuestionID int64, Answer CommonParams) {
	// 获取指定的 conversation
	conv, ok := e.registry.GetConversation(convID)
	if !ok {
		return
	}

	// 查找并回答对应的问题
	for _, q := range conv.Questions {
		if q.Id == QuestionID {
			q.Answer = Answer
			break
		}
	}
	conv.UpdateStatus()
	go e.ThinkLoop(conv)
}

// ResumePossess 恢复附身后的思考循环（用户回复后调用）。
func (e *Engine) ResumePossess(convID ConversationID, possessResp *PossessResponse) error {
	if possessResp.Error != nil {
		return fmt.Errorf("possess response error: %w", possessResp.Error)
	}

	// 获取指定的 conversation
	conv, ok := e.registry.GetConversation(convID)
	if !ok {
		return fmt.Errorf("conversation %s not found", convID)
	}

	// 使用用户确认/修改后的结果执行方法
	action, err := e.executor.ExecuteMethod(possessResp.Method, conv, possessResp.Parameters)
	if err != nil {
		return fmt.Errorf("execute method failed: %w", err)
	}

	// respond 等特殊方法没有返回 Action，无需处理
	if action != nil {
		conv.Actions = append(conv.Actions, action)
	}

	// 继续思考循环
	go e.ThinkLoop(conv)
	return nil
}

// Think 执行一次思考
func (e *Engine) Think(conv *Conversation) error {
	// 1. AssembleContext：构造 LLM 输入
	req := conv.Prompt()

	// 2. 准备工具列表
	tools := make([]llm.Tool, 0, len(conv.Methods()))

	// conversation 的固定方法
	{
		tools = append(tools, llm.Tool{
			Name:        (&MethodTalk{}).Name(),
			Description: (&MethodTalk{}).Document(),
			Parameters:  json.RawMessage((&MethodTalk{}).Parameters()),
		})
		tools = append(tools, llm.Tool{
			Name:        (&MethodFocus{}).Name(),
			Description: (&MethodFocus{}).Document(),
			Parameters:  json.RawMessage((&MethodFocus{}).Parameters()),
		})
		tools = append(tools, llm.Tool{
			Name:        (&MethodAsk{}).Name(),
			Description: (&MethodAsk{}).Document(),
			Parameters:  json.RawMessage((&MethodAsk{}).Parameters()),
		})
		tools = append(tools, llm.Tool{
			Name:        (&MethodRespond{}).Name(),
			Description: (&MethodRespond{}).Document(),
			Parameters:  json.RawMessage((&MethodRespond{}).Parameters()),
		})
	}

	info, ok := e.registry.GetInfo(conv.To)
	if !ok {
		return fmt.Errorf("info %s not found", conv.To)
	} else if info.Class() != "conversation" {
		for _, method := range info.Methods() {
			tools = append(tools, llm.Tool{
				Name:        method.Name(),
				Description: method.Description(),
			})
		}
	}

	if conv.IsAction() {
		for _, method := range info.Methods() {
			tools = append(tools, llm.Tool{
				Name:        method.Name(),
				Description: method.Document(),
				Parameters:  json.RawMessage(method.Parameters()),
			})
		}
	}

	// 3. 先调用 LLM 获取输出
	resp, err := e.llm.Call(&llm.Request{
		Prompt: req,
		Tools:  tools,
	})
	if err != nil {
		return fmt.Errorf("llm call failed: %w", err)
	}

	// 4. 检查是否处于附身状态
	if e.possessCallback != nil {
		// 附身模式：将 LLM 输出转发给用户，等待用户确认/修改
		toolNames := make([]string, len(tools))
		for i, tool := range tools {
			toolNames[i] = tool.Name
		}

		possessReq := &PossessRequest{
			ConversationID: conv.ID,
			Prompt:         req,
			Tools:          toolNames,
			LLMMethod:      resp.Method,
			LLMParams:      resp.Parameters,
		}

		// 调用回调函数保存请求到 Session
		e.possessCallback(possessReq)

		// 返回特殊错误让 ThinkLoop 退出，等待用户回复
		return fmt.Errorf("possess_request_sent")
	}

	// 正常模式：直接使用 LLM 输出

	// 5. 处理响应
	action, err := e.executor.ExecuteMethod(resp.Method, conv, json.RawMessage(resp.Parameters))
	if err != nil {
		return fmt.Errorf("execute method failed: %w", err)
	}

	// respond 等特殊方法没有返回 Action，无需处理
	if action == nil {
		return nil
	}

	// 5. 更新 conv
	conv.Actions = append(conv.Actions, action)
	return nil
}

// ThinkLoop 执行思考循环，直到对话完成或遇到 Ask。
func (e *Engine) ThinkLoop(conv *Conversation) error {
	for ; e.maxLoopCount < 300; e.maxLoopCount++ {
		// 如果对话已完成、等待用户或出错，直接返回。
		if conv.Status == StatusCompleted {
			// 检查是否是用户与系统的对话（From: User, To: System），如果是，更新 session 状态
			e.checkAndUpdateSessionStatus(conv)
			return nil
		}
		if conv.Status == StatusWaitingAnswer {
			// 检查是否是用户与系统的对话，如果是，更新 session 状态
			if e.isUserSystemConversation(conv) {
				if e.sessionStatusCallback != nil {
					e.sessionStatusCallback("waiting_answer")
				}
			}
			return nil
		}
		if conv.Status == StatusError {
			return fmt.Errorf("conversation error: %s", conv.Error)
		}

		// 执行一次思考。
		err := e.Think(conv)
		if err != nil {
			// 检查是否是附身请求发送错误（需要退出循环等待用户回复）
			if err.Error() == "possess_request_sent" {
				// 如果是用户与系统的对话，需要更新 session 状态为 waiting_possess
				if e.isUserSystemConversation(conv) {
					if e.sessionStatusCallback != nil {
						e.sessionStatusCallback("waiting_possess")
					}
				}
				// 退出循环，等待用户回复
				return nil
			}
			// 其他错误：设置错误状态
			conv.Status = StatusError
			conv.Error = err.Error()
			// 如果是用户与系统的对话，需要更新 session 状态
			if e.isUserSystemConversation(conv) {
				e.updateSessionStatusOnError()
			}
			return err
		}

		if conv.Status == StatusCompleted {
			// 检查是否是用户与系统的对话，如果是，更新 session 状态
			e.checkAndUpdateSessionStatus(conv)
			return nil
		}
		if conv.Status == StatusWaitingAnswer {
			// 检查是否是用户与系统的对话，如果是，更新 session 状态
			if e.isUserSystemConversation(conv) {
				if e.sessionStatusCallback != nil {
					e.sessionStatusCallback("waiting_answer")
				}
			}
			return nil
		}
		if conv.Status == StatusError {
			return fmt.Errorf("conversation error: %s", conv.Error)
		}

		// 继续循环
	}

	// 超时错误
	err := fmt.Errorf("think loop timeout")
	conv.Status = StatusError
	conv.Error = err.Error()
	// 如果是用户与系统的对话，需要更新 session 状态
	if e.isUserSystemConversation(conv) {
		e.updateSessionStatusOnError()
	}
	return err
}

// isUserSystemConversation 检查 conversation 是否是用户与系统的对话（From: User, To: System）
func (e *Engine) isUserSystemConversation(conv *Conversation) bool {
	return conv.From == WrapInfoID("user", "User") && conv.To == WrapInfoID("system", "System")
}

// checkAndUpdateSessionStatus 检查并更新 session 状态
func (e *Engine) checkAndUpdateSessionStatus(conv *Conversation) {
	if e.sessionStatusCallback == nil {
		return
	}

	// 如果是用户与系统的对话且已完成，更新 session 状态
	if e.isUserSystemConversation(conv) && conv.Status == StatusCompleted {
		// 检查是否有 response，如果有，说明已经 respond
		if conv.Response.Content != "" {
			e.sessionStatusCallback("completed")
		}
	}
}
