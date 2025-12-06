// Package main 提供 storybook 命令行入口。
package main

import (
	"flag"
	"fmt"
	"log"
	"ooc/internal/agent"
	"ooc/internal/client/llm"
	"ooc/internal/module/notebook"
	"ooc/internal/session"
	"ooc/internal/utils/config"
	"os"
	"time"
)

var stories = map[string]*Story{}

func main() {
	var storyName string
	var runAll bool
	flag.StringVar(&storyName, "story", "", "运行指定的 story 名称")
	flag.BoolVar(&runAll, "all", false, "运行所有 stories")
	flag.Parse()

	sb, err := NewStorybook()
	if err != nil {
		log.Fatalf("create storybook failed: %v", err)
	}

	if runAll {
		if err := sb.RunAllStories(); err != nil {
			log.Fatalf("run all stories failed: %v", err)
		}
	} else if storyName != "" {
		if err := sb.RunStoryByName(storyName); err != nil {
			log.Fatalf("run story %s failed: %v", storyName, err)
		}
	} else {
		log.Println("Usage: storybook -story <name> or -all")
		os.Exit(1)
	}
}

// Story 定义一个测试用例。
type Story struct {
	Name        string
	Description string
	Request     string
	Expected    string // 期望的结果（可选）
	MaxWait     time.Duration
}

// Storybook 测试用例集管理器。
type Storybook struct {
	store     session.Store
	llmClient llm.Client
	engine    *agent.Engine
}

// NewStorybook 创建 Storybook 实例。
func NewStorybook() (*Storybook, error) {
	// 加载配置。
	cfg, err := config.LoadFromFile(".conf.xml")
	if err != nil {
		return nil, fmt.Errorf("load config failed: %w", err)
	}

	// 创建 LLM 客户端（真实 HTTP 客户端）。
	llmClient := llm.NewHTTPClient(&cfg.AI)

	// 创建 Engine。
	engine := agent.New(llmClient)
	agent.GetModuleManager(engine).Register(notebook.NewModule())

	// 创建 Session Store。
	store := session.NewMemoryStore()

	return &Storybook{
		store:     store,
		llmClient: llmClient,
		engine:    engine,
	}, nil
}

// RunStoryByName 运行指定的 story。
func (sb *Storybook) RunStoryByName(name string) error {
	story, ok := stories[name]
	if !ok {
		return fmt.Errorf("story %s not found", name)
	}

	log.Printf("Running story: %s", story.Name)
	log.Printf("Description: %s", story.Description)
	log.Printf("Request: %s", story.Request)
	log.Printf("Max wait: %v", story.MaxWait)
	log.Println("---")

	// 创建 Session。
	sess := &session.Session{
		UserRequest: story.Request,
		Status:      session.SessionStatusPending,
		Engine:      sb.engine,
	}
	sessID, err := sb.store.SaveSession(sess)
	if err != nil {
		return fmt.Errorf("save session failed: %w", err)
	}

	// 记录会话开始事件。
	sb.store.AppendEvent(sessID, &session.Event{
		Type:    session.EventConversationStarted,
		Payload: story.Request,
	})

	// 创建新的 Engine 实例（每个 story 使用独立的 engine）。
	engine := agent.New(sb.llmClient)
	agent.GetModuleManager(engine).Register(notebook.NewModule())
	sess.Engine = engine

	// 运行请求。
	engine.Run(agent.CommonParams{
		Content: story.Request,
	})

	// 等待完成或超时。
	timeout := time.After(story.MaxWait)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			sess.Status = session.SessionStatusFailed
			sb.store.SaveSession(sess)
			return fmt.Errorf("story timeout after %v", story.MaxWait)
		case <-ticker.C:
			// 检查对话状态。
			if engine.ConversationID != "" {
				conv, ok := agent.GetRegistry(engine).GetConversation(engine.ConversationID)
				if ok {
					if conv.Status == agent.StatusCompleted {
						// 对话完成。
						sess.Result = &conv.Response
						sess.Status = session.SessionStatusCompleted
						sb.store.SaveSession(sess)

						sb.store.AppendEvent(sessID, &session.Event{
							Type:    session.EventConversationEnded,
							Payload: conv.Response.Content,
						})

						log.Println("---")
						log.Printf("Story completed: %s", story.Name)
						log.Printf("Response: %s", conv.Response.Content)
						if story.Expected != "" {
							log.Printf("Expected: %s", story.Expected)
						}
						return nil
					}

					if conv.Status == agent.StatusWaitingAnswer {
						// 等待用户回答（storybook 模式下，我们无法回答，所以标记为失败）。
						sess.Status = session.SessionStatusWaitingAnswer
						sb.store.SaveSession(sess)

						log.Println("---")
						log.Printf("Story waiting for answer: %s", story.Name)
						log.Printf("Questions:")
						for _, q := range conv.Questions {
							if q.Answer.Content == "" {
								log.Printf("  - %s", q.Question.Content)
							}
						}
						return fmt.Errorf("story requires user interaction")
					}
				}
			}
		}
	}
}

// RunAllStories 运行所有 stories。
func (sb *Storybook) RunAllStories() error {
	log.Printf("Running all stories (total: %d)", len(stories))
	log.Println("=")

	var failed []string
	var success []string

	for name := range stories {
		log.Printf("\n[Story: %s]\n", name)
		err := sb.RunStoryByName(name)
		if err != nil {
			log.Printf("Story %s failed: %v", name, err)
			failed = append(failed, name)
		} else {
			log.Printf("Story %s succeeded", name)
			success = append(success, name)
		}
		log.Println()
	}

	log.Println("=")
	log.Printf("Summary: %d succeeded, %d failed", len(success), len(failed))
	if len(failed) > 0 {
		log.Printf("Failed stories: %v", failed)
		return fmt.Errorf("%d stories failed", len(failed))
	}

	return nil
}
