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

// Name 返回 Conversation 的名称。
func (c *Conversation) Name() string {
	return c.ID
}

// Description 返回 Conversation 的描述。
func (c *Conversation) Description() string {
	var desc strings.Builder
	if c.Title != "" {
		desc.WriteString("标题: " + c.Title + "; ")
	}
	if c.Desc != "" {
		desc.WriteString("描述: " + c.Desc + "; ")
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

// Prompt 组装对话上下文。
// 如果是 Action 模式，会包含 Method 的 Document 和 Parameters（meta.md 65）。
func (conv *Conversation) Prompt() string {
	var prompt strings.Builder
	prompt.WriteString(`
# Conversation 机制
Conversation 是 OOC（Object-Oriented Context）的核心概念，它记录了一次对话的上下文。
在 OOC 中，一切信息对象都是可对话的，包括 Conversation 本身、包括信息对象的可执行方法。而 Conversation 是两个信息对象之间的对话记录。
Conversation 有两个角色，From 和 To，From 是发起对话的信息对象，To 是被对话的信息对象。
在下文中，列出了 你（对应角色 Conversation To） 的信息、发起对话的信息对象（From）的信息以及这一次 Conversation 的信息
`) // 说明 Conversation 机制

	// 0. 展示 Conversation.From 的信息
	fromInfo, ok := conv.engine.registry.GetInfo(conv.From)
	if ok && fromInfo != nil {
		prompt.WriteString("\n## 发起对话的信息对象（From）\n")
		prompt.WriteString("ID: " + conv.From + "\n")
		prompt.WriteString("类型: " + fromInfo.Class() + "\n")
		prompt.WriteString("名称: " + fromInfo.Name() + "\n")
		if description := fromInfo.Description(); description != "" {
			prompt.WriteString("描述: " + description + "\n")
		}
		if p := fromInfo.Prompt(); p != "" {
			prompt.WriteString("提示词:\n" + p + "\n")
		}
		prompt.WriteString("\n")
	}

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
		} else {
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

		// 从 Actions 中收集引用的信息对象
		for _, action := range conv.Actions {
			if action.Typ == "talk" {
				// talk 类型的 Action 会创建新的 Conversation，从子对话中收集引用
				if subConv, exists := conv.engine.registry.GetConversation(action.ConversationID); exists {
					refInfos[WrapInfoID(subConv.Class(), string(subConv.ID))] = subConv
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
			} else if action.Typ == "act" {
				// act 类型的 Action 会引用 Object
				if info, exists := conv.engine.registry.GetInfo(action.Object); exists {
					refInfos[action.Object] = info
				}
				for refID := range action.Response.References {
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

	// 2. Request.Content + Request.References
	prompt.WriteString("## 用户请求\n")
	prompt.WriteString("内容: " + conv.Request.Content + "\n")
	if len(conv.Request.References) > 0 {
		prompt.WriteString("引用的信息对象:\n")
		for refID, reason := range conv.Request.References {
			if info, exists := conv.engine.registry.GetInfo(InfoID(refID)); exists {
				prompt.WriteString("- 信息对象ID: " + refID + "\n")
				prompt.WriteString("  类型: " + info.Class() + "\n")
				prompt.WriteString("  名称: " + info.Name() + "\n")
				prompt.WriteString("  引用原因: " + reason + "\n")
				prompt.WriteString("\n")
			}
		}
	}
	prompt.WriteString("\n")

	// 3. Conversation.Actions
	if len(conv.Actions) > 0 {
		prompt.WriteString("## 执行过程\n")
		for i, action := range conv.Actions {
			prompt.WriteString(fmt.Sprintf("### 步骤 %d\n", i+1))

			if action.Typ == "talk" {
				// 3.1 对于 talk 类型的 Action，展示 sub conversation 的 Request + Questions + Response
				prompt.WriteString("类型: Talk\n")
				if subConv, exists := conv.engine.registry.GetConversation(action.ConversationID); exists {
					prompt.WriteString("子对话 ID: " + string(action.ConversationID) + "\n")

					convTo, _ := conv.engine.registry.GetInfo(subConv.To)

					prompt.WriteString("对话目标: " + WrapInfoID(convTo.Class(), convTo.Name()) + "\n")
					prompt.WriteString("对话目标描述: " + convTo.Description() + "\n")
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
			} else if action.Typ == "act" {
				// 3.2 对于 act 类型的 Action，展示 Object.Name + Object.Description + Object.Method + Object.Method.Description + Request + Response
				prompt.WriteString("类型: Act\n")
				if objInfo, exists := conv.engine.registry.GetInfo(action.Object); exists {
					prompt.WriteString("信息对象ID: " + string(action.Object) + "\n")
					prompt.WriteString("类型: " + objInfo.Class() + "\n")
					prompt.WriteString("名称: " + objInfo.Name() + "\n")
					prompt.WriteString("对象描述: " + objInfo.Description() + "\n")
				}
				prompt.WriteString("执行方法: " + action.Method + "\n")

				// 尝试获取方法的描述
				if objInfo, exists := conv.engine.registry.GetInfo(action.Object); exists {
					for _, method := range objInfo.Methods() {
						if method.Name() == action.Method {
							prompt.WriteString("方法描述: " + method.Description() + "\n")
							break
						}
					}
				}

				if len(action.Request) > 0 {
					prompt.WriteString("请求参数: " + string(action.Request) + "\n")
				}
				if action.Response.Content != "" {
					prompt.WriteString("响应: " + action.Response.Content + "\n")
				}
				if len(action.Response.References) > 0 {
					prompt.WriteString("响应引用的信息对象:\n")
					for refID, reason := range action.Response.References {
						if info, exists := conv.engine.registry.GetInfo(InfoID(refID)); exists {
							prompt.WriteString("- 信息对象ID: " + refID + "\n")
							prompt.WriteString("  类型: " + info.Class() + "\n")
							prompt.WriteString("  名称: " + info.Name() + "\n")
							prompt.WriteString("  引用原因: " + reason + "\n")
						}
					}
				}
			}
			prompt.WriteString("\n")
		}
	}

	// 注意 conv.Questions 是对外提出的问题，是需要等待用户回答的
	if len(conv.Questions) > 0 {
		var hasAnswer bool
		for _, q := range conv.Questions {
			if q.Answer.Content != "" {
				hasAnswer = true
				break
			}
		}
		if hasAnswer {
			prompt.WriteString("## 当前 Conversation 中, 你向对方提出的并被回答的问题\n")
			for _, q := range conv.Questions {
				prompt.WriteString("- 问题: " + q.Question.Content + "\n")
				prompt.WriteString("  回答: " + q.Answer.Content + "\n")
			}
			prompt.WriteString("\n")
		}
	}

	return prompt.String()
}
