// Package agent 的 conversation.info.go 实现 ConversationState 的 InfoI 接口。
package agent

import (
	"fmt"
	"strings"
)

// 确保 ConversationState 实现 InfoI 接口。
var _ InfoI = (*Conversation)(nil)

func (c *Conversation) Class() string {
	return "conversation"
}

// ID 返回 Conversation 的完整 ID（含 class 前缀）。
func (c *Conversation) ID() string {
	return string(c.IDValue)
}

// Name 返回 Conversation 的名称。
func (c *Conversation) Name() string {
	if c.Title != "" {
		return c.Title
	}
	return strings.TrimPrefix(string(c.IDValue), c.Class()+"::")
}

// Description 返回 Conversation 的描述。
func (c *Conversation) Description() string {
	var desc strings.Builder
	if c.Desc != "" {
		desc.WriteString("描述: " + c.Desc + "; ")
	} else if c.Title != "" {
		desc.WriteString("标题: " + c.Title + "; ")
	}
	if desc.Len() > 0 {
		return desc.String()
	}
	return "Conversation: " + c.Request.Content
}

// Methods 返回 Conversation 可执行的方法（当前为空，后续可扩展）。
func (c *Conversation) Methods() []MethodI {
	return []MethodI{
		&MethodAsk{},
		&MethodAnswer{},
		&MethodFocus{},
		&MethodTalk{},
		&MethodRespond{},
	}
}

// conversationSystemPrompt 返回通用的 system prompt，介绍 Conversation 机制与可用方法。
func conversationSystemPrompt() string {
	var prompt strings.Builder
	prompt.WriteString("# Conversation 机制\n")
	prompt.WriteString("Conversation 记录 From（会话发起者）与 To（被对话者）之间的一次对话，。“你” 是其中的被对话者，需要根据对方输入的信息和你自己的信息进行思考和行动。\n")
	prompt.WriteString("\n## 可用方法\n")
	prompt.WriteString("- respond: 完成当前对话并返回结果给会话发起者。\n")
	prompt.WriteString("- talk: 向其他信息对象发起新的对话; 所有信息对象都可对话，特别地，对象的方法本身也可作为可谈话的对象、而 Conversation 对象本身也可以对话（你可以向这个谈话过程进行追问更多信息）。\n")
	prompt.WriteString("- ask: 向会话发起者提出问题，等待回答。\n")
	prompt.WriteString("- focus: 聚焦子问题。\n")
	return prompt.String()
}

// Prompt 组装对话上下文。
// 如果是 Action 模式，会包含 Method 的 Document 和 Parameters（meta.md 65）。
func (conv *Conversation) Prompt() string {
	var prompt strings.Builder

	// 如果 Conversation 处于错误状态，展示错误信息
	if conv.Status == StatusError && conv.Error != "" {
		prompt.WriteString("\n## ⚠️ 错误信息\n")
		prompt.WriteString("当前 Conversation 遇到了错误，错误信息如下：\n\n")
		prompt.WriteString(conv.Error + "\n\n")
		prompt.WriteString("请根据错误信息进行相应的处理。\n\n")
	}

	// 1. Conversation.To 的 Prompt
	toInfo, ok := conv.engine.registry.GetInfo(conv.To)
	if ok {
		if conv.IsAction() {
			prompt.WriteString("## 当前信息对象（你、一个可执行方法）\n")
			// Action 模式下，To 是一个 Method 对象
			if toInfo != nil {
				methods := toInfo.Methods()
				if len(methods) > 0 {
					method := methods[0] // Action 模式下只有一个方法
					prompt.WriteString("ID: " + conv.To + "\n")
					prompt.WriteString("方法名称: " + method.Name() + "\n")
					prompt.WriteString("方法描述: " + method.Description() + "\n")
					prompt.WriteString("方法文档:\n" + method.Document() + "\n")
					prompt.WriteString("参数 Schema:\n" + method.Parameters() + "\n\n")
				}
			}
		} else if toInfo.Class() != "conversation" { // 避免套娃
			prompt.WriteString("## 当前信息对象（你）\n")
			prompt.WriteString("ID: " + conv.To + "\n")
			prompt.WriteString("类型: " + toInfo.Class() + "\n")
			prompt.WriteString("名称: " + toInfo.Name() + "\n")
			prompt.WriteString("描述: " + toInfo.Description() + "\n")
			prompt.WriteString("提示词:\n" + toInfo.Prompt() + "\n\n")
		}
	}

	// 1.1 展示 Conversation 的可 Talk 的方法列表
	// 遍历这个 Conversation 中引用到的所有信息对象，调用它们的 Methods 方法获取方法列表，去重、排序后展示
	{
		var prompt2 strings.Builder
		// 收集所有引用的信息对象
		refInfos := make(map[InfoID]InfoI)
		refMethods := make(map[string]MethodI)

		// 从 Request.References 收集
		for refID := range conv.Request.References {
			if info, exists := conv.engine.registry.GetInfo(InfoID(refID)); exists {
				refInfos[InfoID(refID)] = info
			}
		}

		// 从 Response.References 收集
		for refID := range conv.Response.References {
			if info, exists := conv.engine.registry.GetInfo(InfoID(refID)); exists {
				refInfos[InfoID(refID)] = info
			}
		}

		// 从 Activities 中收集引用的信息对象
		for _, activity := range conv.Activities {
			switch activity.Typ {
			case "talk", "focus":
				// talk 类型的 Activity 会创建新的 Conversation，从子对话中收集引用
				if subConv, exists := conv.engine.registry.GetConversation(activity.ConversationID); exists {
					refInfos[subConv.ID()] = subConv
					for refID := range subConv.Request.References {
						if info, exists := conv.engine.registry.GetInfo(InfoID(refID)); exists {
							refInfos[InfoID(refID)] = info
						}
					}
					for refID := range subConv.Response.References {
						if info, exists := conv.engine.registry.GetInfo(InfoID(refID)); exists {
							refInfos[InfoID(refID)] = info
						}
					}
				}
			case "act":
				// act 类型的 Activity 会引用 Object
				if info, exists := conv.engine.registry.GetInfo(activity.Object); exists {
					refInfos[activity.Object] = info
				}
				for refID := range activity.Response.References {
					if info, exists := conv.engine.registry.GetInfo(InfoID(refID)); exists {
						refInfos[InfoID(refID)] = info
					}
				}
			}
		}

		// 展示所有可交互的信息对象
		for refID, info := range refInfos {
			prompt2.WriteString("- 信息对象ID: " + refID + "\n")
			prompt2.WriteString("  类型: " + info.Class() + "\n")
			prompt2.WriteString("  名称: " + info.Name() + "\n")
			prompt2.WriteString("  描述: " + info.Description() + "\n")
			prompt2.WriteString("\n")
		}
		for methodName, method := range refMethods {
			prompt2.WriteString("- 信息对象ID: method::" + methodName + "\n")
			prompt2.WriteString("  类型: " + "method" + "\n")
			prompt2.WriteString("  名称: " + method.Name() + "\n")
			prompt2.WriteString("  描述: " + method.Description() + "\n")
			prompt2.WriteString("\n")
		}

		if len(refInfos) > 0 || len(refMethods) > 0 {
			prompt.WriteString("## 可交互的信息对象\n")
			prompt.WriteString("你可以使用 Talk 方法与以下信息对象进行对话。注意：Method 也可以是 talk 的对象。\n\n")
			prompt.WriteString(prompt2.String())
		}
	}

	// step 计数器放在 renderActivities 外层，因为可能存在父会话，需要连通多个会话的 step 序号
	step := 1

	// 2. Conversation.Activities（支持父会话 + 当前会话的连续展示，将 Request/Activities/Response 串联）
	renderActivities := func(target *Conversation, title string) {
		prompt.WriteString(title)

		renderRefs := func(refs map[string]string) {
			if len(refs) == 0 {
				return
			}
			prompt.WriteString("引用的信息对象:\n")
			for refID, reason := range refs {
				if info, exists := target.engine.registry.GetInfo(InfoID(refID)); exists {
					prompt.WriteString("- 信息对象ID: " + refID + "\n")
					prompt.WriteString("  类型: " + info.Class() + "\n")
					prompt.WriteString("  名称: " + info.Name() + "\n")
					prompt.WriteString("  引用原因: " + reason + "\n")
				}
			}
			prompt.WriteString("\n")
		}

		// Request 作为首个 activity
		if target.Request.Content != "" || len(target.Request.References) > 0 {
			prompt.WriteString(fmt.Sprintf("### Activity %d (Request)\n", step))
			step++
			prompt.WriteString("类型: Request\n")
			prompt.WriteString("内容: " + target.Request.Content + "\n")
			renderRefs(target.Request.References)
		}

		// 中间的 activities
		for _, activity := range target.Activities {
			prompt.WriteString(fmt.Sprintf("### Activity %d\n", step))
			step++

			if activity.Typ == "talk" || activity.Typ == "focus" {
				// 对于 talk 类型的 Activity，展示子对话的 Request + Questions + Response
				if activity.Typ == "focus" {
					prompt.WriteString("类型: Focus（子问题）\n")
				} else {
					prompt.WriteString("类型: Talk\n")
				}
				if subConv, exists := target.engine.registry.GetConversation(activity.ConversationID); exists {
					prompt.WriteString("子对话 ID: " + string(activity.ConversationID) + "\n")

					convTo, _ := target.engine.registry.GetInfo(subConv.To)
					if convTo != nil {
						prompt.WriteString("对话目标: " + convTo.ID() + "\n")
						prompt.WriteString("对话目标描述: " + convTo.Description() + "\n")
					}
					prompt.WriteString("对话标题: " + subConv.Title + "\n")
					prompt.WriteString("请求: " + subConv.Request.Content + "\n")

					if len(subConv.Questions) > 0 {
						prompt.WriteString("对话目标 向你提出的问题:\n")
						for _, q := range subConv.Questions {
							prompt.WriteString("- " + q.Question.Content + "\n")
							if q.Answer.Content != "" {
								prompt.WriteString("  你的回答: " + q.Answer.Content + "\n")
							}
						}
					}

					if subConv.Response.Content != "" {
						prompt.WriteString("对话目标的最终回复: " + subConv.Response.Content + "\n")
					}
				}
			} else if activity.Typ == "act" {
				// 对于 act 类型的 Activity，展示 Object 信息与执行摘要
				prompt.WriteString("类型: Act\n")
				if objInfo, exists := target.engine.registry.GetInfo(activity.Object); exists {
					prompt.WriteString("信息对象ID: " + string(activity.Object) + "\n")
					prompt.WriteString("类型: " + objInfo.Class() + "\n")
					prompt.WriteString("名称: " + objInfo.Name() + "\n")
					prompt.WriteString("对象描述: " + objInfo.Description() + "\n")
				}
				prompt.WriteString("执行方法: " + activity.Method + "\n")

				// 尝试获取方法的描述
				if objInfo, exists := target.engine.registry.GetInfo(activity.Object); exists {
					for _, method := range objInfo.Methods() {
						if method.Name() == activity.Method {
							prompt.WriteString("方法描述: " + method.Description() + "\n")
							break
						}
					}
				}

				if len(activity.Request) > 0 {
					prompt.WriteString("请求参数: " + string(activity.Request) + "\n")
				}
				if activity.Response.Content != "" {
					prompt.WriteString("响应: " + activity.Response.Content + "\n")
				}
				if len(activity.Response.References) > 0 {
					prompt.WriteString("响应引用的信息对象:\n")
					for refID, reason := range activity.Response.References {
						if info, exists := target.engine.registry.GetInfo(InfoID(refID)); exists {
							prompt.WriteString("- 信息对象ID: " + refID + "\n")
							prompt.WriteString("  类型: " + info.Class() + "\n")
							prompt.WriteString("  名称: " + info.Name() + "\n")
							prompt.WriteString("  引用原因: " + reason + "\n")
						}
					}
				}
			} else if activity.Typ == "ask" {
				prompt.WriteString("类型: Ask\n")
				// 查找问题详情
				var question *Question
				for _, q := range target.Questions {
					if q.Id == activity.QuestionID {
						question = q
						break
					}
				}
				if question != nil {
					prompt.WriteString(fmt.Sprintf("问题 ID: %d\n", question.Id))
					prompt.WriteString("问题: " + question.Question.Content + "\n")
					renderRefs(question.Question.References)
					if question.Answer.Content != "" {
						prompt.WriteString("回答: " + question.Answer.Content + "\n")
						renderRefs(question.Answer.References)
					} else {
						prompt.WriteString("回答: (等待中)\n")
					}
				} else {
					prompt.WriteString(fmt.Sprintf("问题未找到 (ID: %d)\n", activity.QuestionID))
				}
			}
			prompt.WriteString("\n")
		}

		// Response 作为末尾 activity
		if target.Response.Content != "" || len(target.Response.References) > 0 {
			prompt.WriteString(fmt.Sprintf("### Activity %d (Response)\n", step))
			prompt.WriteString("类型: Response\n")
			prompt.WriteString("内容: " + target.Response.Content + "\n")
			renderRefs(target.Response.References)
		}
	}

	if conv.Parent != "" {
		if parentConv, exists := conv.engine.registry.GetConversation(conv.Parent); exists {
			renderActivities(parentConv, "## 父对话的执行过程\n")
		}
	}
	renderActivities(conv, "## 执行过程\n")

	return prompt.String()
}
