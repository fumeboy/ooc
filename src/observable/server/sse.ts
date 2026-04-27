import { eventBus, type SSEEvent } from "./events.js";
import { CORS_HEADERS } from "./responses.js";

/**
 * 创建 SSE 响应
 *
 * 使用 ReadableStream 持续推送事件。
 * 客户端断开时自动清理监听器。
 */
export function handleSSE(): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      /** 发送 SSE 格式的事件 */
      const send = (event: SSEEvent) => {
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          /* 连接已关闭，清理 */
          cleanup();
        }
      };

      /* 发送心跳保持连接 */
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        eventBus.removeListener("sse", send);
      };

      /* 监听事件总线 */
      eventBus.on("sse", send);

      /* 发送连接成功事件 */
      send({ type: "object:updated", name: "_connected" });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...CORS_HEADERS,
    },
  });
}
