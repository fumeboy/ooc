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
	"time"

	"ooc/internal/client/llm"
)

// PossessCallback 附身回调函数，用于将附身请求保存到 Session。
type PossessCallback func(req *PossessRequest)

type Engine struct {
	registry     *Registry
	llm          llm.Client
	executor     *ModuleManager
	maxLoopCount int

	User *UserInfo // User 信息对象，管理所有与 User 相关的 Conversation

	// Session 状态更新回调（当 conversation 状态变化时调用）
	sessionStatusCallback func(status string)

	// 状态监听：当 Conversation 状态变更为 StatusRunning 时，自动启动 thinkloop
	runningConversations map[ConversationID]*Conversation
	runningMu            sync.Mutex

	// 附身功能相关字段
	Possessed bool // 是否全局开启半托管模式
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

	userInfo := &UserInfo{
		engine:        nil, // 稍后设置
		conversations: make([]*Conversation, 0),
	}

	var e = &Engine{
		registry:             reg,
		llm:                  client,
		executor:             m,
		User:                 userInfo,
		runningConversations: make(map[ConversationID]*Conversation),
	}

	userInfo.engine = e
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

// UserTalk 让 User 执行一次 Talk 方法
// 创建一个临时的 conversation（From: User），然后执行 Talk 方法
func (e *Engine) UserTalk(talkWith string, title string, content string, references map[string]string) (ConversationID, error) {
	// 执行 Talk 方法
	methodTalk := &MethodTalk{
		e:          e,
		Title:      title,
		Content:    content,
		References: references,
		TalkWith:   talkWith,
	}

	action, err := methodTalk.execute(e.User.ID())
	if err != nil {
		return "", fmt.Errorf("execute talk failed: %w", err)
	}

	return action.ConversationID, nil
}

// GetLastConversationCreatedByUser 获取 User 作为 From 创建的最后一个 conversation 的 ID
func (e *Engine) GetLastConversationCreatedByUser() ConversationID {
	userID := WrapInfoID("user", "user")
	convs := e.User.GetConversations()

	// 从后往前查找，找到最后一个 User 作为 From 的 conversation
	for i := len(convs) - 1; i >= 0; i-- {
		if convs[i].From == userID {
			return convs[i].IDValue
		}
	}

	return ""
}

// GetConversations 获取 User 的所有 conversation 列表
func (e *Engine) GetConversations() []*Conversation {
	return e.User.GetConversations()
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

	// 如果状态变为 StatusRunning，触发 thinkloop
	if conv.Status == StatusRunning {
		e.NotifyConversationRunning(conv)
	}
}

// ResumeManualThink 恢复手动思考（用户回复后调用）。
// 用于处理 StatusWaitingManualThink 状态的 conversation
func (e *Engine) ResumeManualThink(convID ConversationID, method string, parameters json.RawMessage) error {
	// 获取指定的 conversation
	conv, ok := e.registry.GetConversation(convID)
	if !ok {
		return fmt.Errorf("conversation %s not found", convID)
	}

	if conv.Status != StatusWaitingManualThink {
		return fmt.Errorf("conversation %s is not in waiting_manual_think status", convID)
	}

	// 清除等待手动思考的请求
	conv.WaitingManualThinkRequest = nil
	conv.Status = StatusRunning

	// 使用用户确认/修改后的结果执行方法
	action, err := e.executor.ExecuteMethod(method, conv, parameters)
	if err != nil {
		return fmt.Errorf("execute method failed: %w", err)
	}

	// respond 等特殊方法没有返回 Action，无需处理
	if action != nil {
		conv.Activities = append(conv.Activities, action)
		conv.UpdatedAt = time.Now()
	}

	if conv.Status == StatusRunning {
		e.NotifyConversationRunning(conv)
	}

	return nil
}

// Think 执行一次思考
func (e *Engine) Think(conv *Conversation) error {
	// 1. AssembleContext：构造 LLM 输入
	req := conv.Prompt()
	systemPrompt := conversationSystemPrompt()

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

	toolNames := make([]string, len(tools))
	for i, tool := range tools {
		toolNames[i] = tool.Name
	}

	// 3. 检查 Conversation 的模式
	actualMode := conv.Mode
	if actualMode == "" {
		actualMode = ConversationModeHosted // 默认为自动托管模式
	}

	// 如果 Engine.Possessed 为 true 且当前 conversation 的 mode 为 hosted，则变更为 semi_hosted
	if e.Possessed && actualMode == ConversationModeHosted {
		actualMode = ConversationModeSemiHosted
	}

	if actualMode == ConversationModeManual {
		conv.Status = StatusWaitingManualThink
		conv.WaitingManualThinkRequest = &ManualThinkRequest{
			ConversationID: conv.IDValue,
			Prompt:         req,
			Tools:          toolNames,
		}
		return nil
	}

	// 4. 调用 LLM 获取输出
	resp, err := e.llm.Call(&llm.Request{
		Prompt: req,
		Tools:  tools,
		Messages: []llm.Message{
			{Role: "system", Content: systemPrompt},
		},
	})
	if err != nil {
		return fmt.Errorf("llm call failed: %w", err)
	}

	// 半托管模式：设置状态为 StatusWaitingManualThink，记录 LLM 输出
	if actualMode == ConversationModeSemiHosted {

		conv.Status = StatusWaitingManualThink
		conv.WaitingManualThinkRequest = &ManualThinkRequest{
			ConversationID: conv.IDValue,
			Prompt:         req,
			Tools:          toolNames,
			LLMMethod:      resp.Method,
			LLMParams:      resp.Parameters,
		}
		conv.UpdatedAt = time.Now()

		// 退出 thinkloop，等待用户手动思考
		return nil
	}

	// 托管模式：直接使用 LLM 输出

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
	conv.Activities = append(conv.Activities, action)
	return nil
}

// NotifyConversationRunning 当 Conversation 状态变更为 StatusRunning 时，启动 thinkloop
func (e *Engine) NotifyConversationRunning(conv *Conversation) {
	e.runningMu.Lock()
	defer e.runningMu.Unlock()

	// 检查是否已经在运行
	if _, exists := e.runningConversations[conv.IDValue]; exists {
		return
	}

	// 记录正在运行的 conversation
	e.runningConversations[conv.IDValue] = conv

	// 启动 thinkloop
	go func() {
		defer func() {
			e.runningMu.Lock()
			delete(e.runningConversations, conv.IDValue)
			e.runningMu.Unlock()
		}()
		e.ThinkLoop(conv)
	}()
}

// ThinkLoop 执行思考循环，直到对话完成或遇到 Ask。
// 根据 Conversation 的模式决定是否自动执行：
// - 人工模式：不自动执行，等待用户手动触发 Think
// - 托管模式：自动执行思考循环
// - 半托管模式：自动执行，但在执行 Method 前等待用户确认
func (e *Engine) ThinkLoop(conv *Conversation) (err error) {
	// 使用 defer 统一处理 session 状态更新
	defer func() {
		// thinkloop 结束时更新 session 状态
		e.updateSessionStatus()
	}()

	// 托管模式或半托管模式：自动执行思考循环
	for ; e.maxLoopCount < 300; e.maxLoopCount++ {
		// 如果对话已完成、等待用户或出错，直接返回。
		if conv.Status == StatusCompleted {
			return nil
		}
		if conv.Status == StatusWaitingAnswer {
			return nil
		}
		if conv.Status == StatusWaitingManualThink {
			return nil
		}
		if conv.Status == StatusError {
			err = fmt.Errorf("conversation error: %s", conv.Error)
			return err
		}

		// 执行一次思考。
		err = e.Think(conv)
		if err != nil {
			conv.Status = StatusError
			conv.Error = err.Error()
			return err
		}

		// 继续循环
	}

	// 超时错误
	err = fmt.Errorf("think loop timeout")
	conv.Status = StatusError
	conv.Error = err.Error()
	return err
}

// updateSessionStatus 根据 UserInfo 的 Conversations 状态聚合更新 session 状态
// 状态优先级从高到低为：waiting_manual_think、waiting_answer、running、error、completed
func (e *Engine) updateSessionStatus() {
	if e.sessionStatusCallback == nil {
		return
	}

	conversations := e.User.GetConversations()
	if len(conversations) == 0 {
		return
	}

	// 状态优先级映射：数字越小优先级越高
	statusPriority := map[string]int{
		StatusWaitingManualThink: 1,
		StatusWaitingAnswer:      2,
		StatusRunning:            3,
		StatusError:              4,
		StatusCompleted:          5,
	}

	// 找到最高优先级的状态
	highestPriority := 999
	highestStatus := ""
	for _, conv := range conversations {
		priority, exists := statusPriority[conv.Status]
		if exists && priority < highestPriority {
			highestPriority = priority
			highestStatus = conv.Status
		}
	}

	// 如果找到了状态，更新 session
	if highestStatus != "" {
		e.sessionStatusCallback(highestStatus)
	}
}
