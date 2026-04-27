/**
 * 应用层 HTTP 服务启动装配
 *
 * 负责把 Bun.serve、CORS、错误日志和 observable/server 的路由处理连接起来。
 */

import { consola } from "consola";
import type { World } from "../world/index.js";
import { handleRoute } from "../observable/server/server.js";
import { CORS_HEADERS, errorResponse } from "../observable/server/responses.js";

/** 服务器配置 */
export interface ServerConfig {
  /** 端口号 */
  port: number;
  /** World 实例 */
  world: World;
}

/** 创建并启动 HTTP 服务器 */
export function startServer(config: ServerConfig): void {
  const { port, world } = config;

  const server = Bun.serve({
    port,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      try {
        return await handleRoute(method, url.pathname, req, world);
      } catch (e) {
        consola.error("[Server] 请求处理失败:", (e as Error).message);
        return errorResponse((e as Error).message, 500);
      }
    },
  });

  consola.info(`[Server] OOC 服务器启动于 http://localhost:${server.port}`);
}
