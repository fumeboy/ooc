// Package main 提供 HTTP 服务器入口。
// 功能：
//   - 加载配置并启动 HTTP 服务器。
//   - 提供 Session 管理、Conversation 操作等 REST API。
//   - 支持优雅退出和健康检查。
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ooc/internal/client/llm"
	"ooc/internal/server"
	"ooc/internal/session"
	"ooc/internal/utils/config"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

var (
	configPath = flag.String("config", ".conf.xml", "配置文件路径")
	port       = flag.String("port", "8080", "服务器监听端口")
	debug      = flag.Bool("debug", false, "启用 debug 模式（详细日志）")
)

func main() {
	flag.Parse()

	// 加载配置。
	cfg, err := config.LoadFromFile(*configPath)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	// 创建 Session Store。
	store := session.NewMemoryStore()

	// 创建 LLM 客户端。
	llmClient := llm.NewHTTPClient(&cfg.AI)

	// 创建 Server。
	srv := server.NewServer(store, llmClient, cfg)

	// 创建 Echo 实例。
	e := echo.New()
	e.HideBanner = true

	// 添加中间件。
	if *debug {
		// Debug 模式：详细日志
		e.Use(middleware.LoggerWithConfig(middleware.LoggerConfig{
			Format: "[${time_rfc3339}] ${status} ${method} ${uri} ${latency_human} ${error}\n",
		}))
		log.Println("Debug 模式已启用")
	} else {
		// 普通模式：简洁日志
		e.Use(middleware.Logger())
	}
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	{
		os.MkdirAll("./.log", 0o755)
		f, err := os.Create("./.log/access.log")
		if err != nil {
			log.Fatalf("open access.log failed: %v", err)
		}
		e.Use(middleware.LoggerWithConfig(middleware.LoggerConfig{
			Output: io.MultiWriter(f), // 需要也输出 stdout 可用 io.MultiWriter(f, os.Stdout)
		}))
	}

	// 注册路由。
	srv.RegisterRoutes(e)

	// 添加健康检查端点。
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{
			"status": "ok",
			"time":   time.Now().Format(time.RFC3339),
		})
	})

	// 启动服务器。
	addr := fmt.Sprintf(":%s", *port)
	log.Printf("服务器启动在端口 %s", *port)
	log.Printf("健康检查: http://localhost:%s/health", *port)
	log.Printf("API 文档: http://localhost:%s/sessions", *port)

	// 在 goroutine 中启动服务器。
	go func() {
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("服务器启动失败: %v", err)
		}
	}()

	// 等待中断信号以优雅关闭服务器。
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("正在关闭服务器...")

	// 优雅关闭，等待最多 10 秒。
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := e.Shutdown(ctx); err != nil {
		log.Fatalf("服务器关闭失败: %v", err)
	}

	log.Println("服务器已关闭")
}
