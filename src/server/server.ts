/**
 * HTTP 服务器
 *
 * 提供 OOC 系统的 HTTP API + SSE 实时事件推送。
 * 使用 Bun 原生 HTTP 服务器。
 *
 * @ref docs/哲学文档/gene.md#G11 — references — 前端通过 API 获取对象数据进行 UI 渲染
 * @ref src/world/world.ts — references — World 根对象（API 操作入口）
 * @ref src/server/events.ts — references — SSE 事件总线
 */

import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { consola } from "consola";
import { eventBus, type SSEEvent } from "./events.js";
import { readFlow, listFlowSessions } from "../persistence/index.js";
import { collectAllActions } from "../process/tree.js";
import { loadTrait } from "../trait/loader.js";
import type { World } from "../world/index.js";
import type { FlowStatus, FlowMessage } from "../types/index.js";

/**
 * 检查 supervisor stone 是否存在
 */
function hasSupervisorStone(world: World): boolean {
  const supervisorDir = join(world.rootDir, "stones", "supervisor");
  return existsSync(supervisorDir);
}

/**
 * 通知 supervisor：用户向某个对象发送了消息
 *
 * 非阻塞、非关键路径。失败时仅打印日志，不影响主流程。
 * 仅在用户直接发消息（from === "human"）且目标不是 supervisor 时触发。
 */
function notifySupervisor(
  world: World,
  objectName: string,
  message: string,
  flowId: string,
): void {
  if (!hasSupervisorStone(world)) return;

  const notification = `[系统通知] 用户向 ${objectName} 发送了消息（flowId: ${flowId}）:\n${message}`;
  world.talk("supervisor", notification, "human").catch((e) => {
    consola.error("[Server] 通知 supervisor 失败:", (e as Error).message);
  });
}

/** 服务器配置 */
export interface ServerConfig {
  /** 端口号 */
  port: number;
  /** World 实例 */
  world: World;
}

/** CORS 头 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** API 响应封装 */
function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** 错误响应 */
function errorResponse(message: string, status: number = 400): Response {
  return json({ success: false, error: message }, status);
}

/**
 * 创建并启动 HTTP 服务器
 */
export function startServer(config: ServerConfig): void {
  const { port, world } = config;

  const server = Bun.serve({
    port,
    idleTimeout: 255, // LLM 调用可能需要较长时间，设为最大值（秒）
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      /* CORS preflight */
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

/**
 * 路由处理
 */
async function handleRoute(
  method: string,
  path: string,
  req: Request,
  world: World,
): Promise<Response> {

  /* ========== SSE ========== */

  /* GET /api/sse — SSE 事件流 */
  if (method === "GET" && path === "/api/sse") {
    return handleSSE();
  }

  /* ========== 对象 CRUD ========== */

  /* GET /api/stones — 列出所有对象 */
  if (method === "GET" && path === "/api/stones") {
    /* 读取 kernel traits 名称列表 */
    const kernelTraitsDir = join(world.rootDir, "kernel", "traits");
    let kernelTraitNames: string[] = [];
    try {
      const entries = readdirSync(kernelTraitsDir, { withFileTypes: true });
      kernelTraitNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch { /* kernel/traits 目录不存在则忽略 */ }

    const objects = world.listObjects().map((s) => ({
      name: s.name,
      talkable: s.talkable,
      traits: [...new Set([...kernelTraitNames, ...s.traits])],
      relations: s.relations,
      data: s.data,
      paused: world.isObjectPaused(s.name),
    }));
    return json({ success: true, data: objects });
  }

  /* POST /api/stones — 创建对象 */
  if (method === "POST" && path === "/api/stones") {
    const body = (await req.json()) as Record<string, unknown>;
    const name = body.name as string;
    const whoAmI = (body.whoAmI as string) || "";
    if (!name) return errorResponse("缺少 name 字段");
    const stone = world.createObject(name, whoAmI);
    return json({ success: true, data: stone.toJSON() }, 201);
  }

  /* POST /api/talk/:objectName — 向对象发消息 */
  const talkMatch = path.match(/^\/api\/talk\/([^/]+)$/);
  if (method === "POST" && talkMatch) {
    const objectName = talkMatch[1]!;
    const body = (await req.json()) as Record<string, unknown>;
    const message = body.message as string;
    const flowId = (body.sessionId ?? body.flowId) as string | undefined;
    if (!message) return errorResponse("缺少 message 字段");
    const flow = await world.talk(objectName, message, "human", flowId);

    /* 通知 supervisor（非阻塞，仅用户直接消息且目标非 supervisor） */
    if (objectName !== "supervisor") {
      notifySupervisor(world, objectName, message, flow.sessionId);
    }

    return json({
      success: true,
      data: {
        sessionId: flow.sessionId,
        status: flow.status,
        actions: [...flow.actions],
        messages: flow.messages,
      },
    });
  }

  /* ========== 暂停/恢复 ========== */

  /* POST /api/stones/:name/pause — 暂停对象 */
  const pauseMatch = path.match(/^\/api\/stones\/([^/]+)\/pause$/);
  if (method === "POST" && pauseMatch) {
    const name = pauseMatch[1]!;
    world.pauseObject(name);
    return json({ success: true, data: { name, paused: true } });
  }

  /* POST /api/stones/:name/resume — 恢复暂停的 Flow */
  const resumeMatch = path.match(/^\/api\/stones\/([^/]+)\/resume$/);
  if (method === "POST" && resumeMatch) {
    const name = resumeMatch[1]!;
    const body = (await req.json()) as Record<string, unknown>;
    const flowId = (body.sessionId ?? body.flowId) as string;
    if (!flowId) return errorResponse("缺少 sessionId 字段");
    const flow = await world.resumeFlow(name, flowId);
    return json({
      success: true,
      data: {
        sessionId: flow.sessionId,
        status: flow.status,
        actions: [...flow.actions],
        messages: flow.messages,
      },
    });
  }

  /* GET /api/stones/:name/flows/:flowId/pending-output — 读取暂存的 LLM 输出 */
  const pendingOutputMatch = path.match(/^\/api\/stones\/([^/]+)\/flows\/([^/]+)\/pending-output$/);
  if (method === "GET" && pendingOutputMatch) {
    const name = pendingOutputMatch[1]!;
    const flowId = pendingOutputMatch[2]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);

    /* 加载 Flow 读取 pending output */
    const { Flow: FlowClass } = await import("../flow/index.js");
    const userStone = world.getObject("user");
    let flow: any = null;
    if (userStone) {
      const userFlowDir = join(world.flowsDir, flowId);
      const mainFlow = FlowClass.load(userFlowDir);
      if (mainFlow) {
        const subFlowDir = join(mainFlow.dir, "objects", name);
        flow = FlowClass.load(subFlowDir);
        if (!flow && mainFlow.stoneName === name) flow = mainFlow;
      }
    }
    if (!flow) {
      flow = FlowClass.load(join(world.flowsDir, flowId));
    }

    if (!flow) return errorResponse(`Flow "${flowId}" 不存在`, 404);

    const data = flow.toJSON();
    return json({
      success: true,
      data: {
        pendingOutput: data.data._pendingOutput ?? null,
        debugMode: data.data.debugMode ?? false,
        status: data.status,
      },
    });
  }

  /* POST /api/stones/:name/flows/:flowId/step — 单步执行 */
  const stepMatch = path.match(/^\/api\/stones\/([^/]+)\/flows\/([^/]+)\/step$/);
  if (method === "POST" && stepMatch) {
    const name = stepMatch[1]!;
    const flowId = stepMatch[2]!;
    const body = (await req.json()) as Record<string, unknown>;
    const modifiedOutput = body.modifiedOutput as string | undefined;

    const flow = await world.stepOnce(name, flowId, modifiedOutput);
    return json({
      success: true,
      data: {
        sessionId: flow.sessionId,
        status: flow.status,
        debugMode: flow.toJSON().data.debugMode ?? false,
      },
    });
  }

  /* POST /api/stones/:name/flows/:flowId/debug-mode — 开启/关闭调试模式 */
  const debugModeMatch = path.match(/^\/api\/stones\/([^/]+)\/flows\/([^/]+)\/debug-mode$/);
  if (method === "POST" && debugModeMatch) {
    const name = debugModeMatch[1]!;
    const flowId = debugModeMatch[2]!;
    const body = (await req.json()) as Record<string, unknown>;
    const enabled = body.enabled === true;

    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);

    /* 加载并更新 Flow */
    const { Flow: FlowCls } = await import("../flow/index.js");
    const sessionDir = join(world.flowsDir, flowId);
    const userStone = world.getObject("user");
    let flow: any = null;
    if (userStone) {
      /* 新结构：session/flows/user/ */
      const mainFlow = FlowCls.load(join(sessionDir, "objects", "user"));
      if (mainFlow) {
        const subFlowDir = join(sessionDir, "objects", name);
        flow = FlowCls.load(subFlowDir);
        if (!flow && mainFlow.stoneName === name) flow = mainFlow;
      }
    }
    if (!flow) {
      /* 兼容旧数据 */
      flow = FlowCls.load(sessionDir);
    }

    if (!flow) return errorResponse(`Flow "${flowId}" 不存在`, 404);

    flow.setFlowData("debugMode", enabled);
    flow.save();

    return json({ success: true, data: { debugMode: enabled } });
  }

  /* ========== 对象详情 ========== */

  /* GET /api/stones/:name/readme — 获取 readme.md 原文 */
  const readmeMatch = path.match(/^\/api\/stones\/([^/]+)\/readme$/);
  if (method === "GET" && readmeMatch) {
    const name = readmeMatch[1]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);
    const readmePath = join(stone.dir, "readme.md");
    if (!existsSync(readmePath)) return json({ success: true, data: { content: "" } });
    const content = readFileSync(readmePath, "utf-8");
    return json({ success: true, data: { content } });
  }

  /* GET /api/stones/:name/traits — 获取 traits 详情 */
  const traitsMatch = path.match(/^\/api\/stones\/([^/]+)\/traits$/);
  if (method === "GET" && traitsMatch) {
    const name = traitsMatch[1]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);
    return json({ success: true, data: await getTraitsInfo(stone.dir, world.rootDir) });
  }

  /* GET /api/flows/groups — 读取 sessions 分组配置 */
  if (method === "GET" && path === "/api/flows/groups") {
    const configPath = join(world.flowsDir, ".flows.json");
    if (!existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify({ groups: [] }, null, 2));
    }
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      return json({ success: true, data: config });
    } catch { return json({ success: true, data: { groups: [] } }); }
  }

  /* GET /api/stones/groups — 读取 stones 分组配置 */
  if (method === "GET" && path === "/api/stones/groups") {
    const configPath = join(world.rootDir, "stones", ".stones.json");
    if (!existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify({ groups: [] }, null, 2));
    }
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      return json({ success: true, data: config });
    } catch { return json({ success: true, data: { groups: [] } }); }
  }

  /* GET /api/flows/:sessionId — 获取单个 Flow 详情 */
  const flowDetailMatch = path.match(/^\/api\/flows\/([^/]+)$/);
  if (method === "GET" && flowDetailMatch) {
    const sessionId = flowDetailMatch[1]!;
    const sessionDir = join(world.flowsDir, sessionId);

    /* 新结构：main flow 在 session/flows/user/ */
    let flow = readFlow(join(sessionDir, "objects", "user"));
    if (!flow) {
      /* 兼容旧数据：session 根目录 */
      flow = readFlow(sessionDir);
    }
    if (!flow) return errorResponse(`Flow "${sessionId}" 不存在`, 404);

    /* 合并 sub-flow 的消息和 process（让前端能看到完整对话和所有对象的行为树） */
    const objectsDir = join(sessionDir, "objects");
    const subFlows: Array<{ stoneName: string; status: FlowStatus; process: unknown }> = [];
    if (existsSync(objectsDir)) {
      const subEntries = readdirSync(objectsDir, { withFileTypes: true });
      for (const entry of subEntries) {
        if (!entry.isDirectory()) continue;
        /* 跳过 user（main flow 自身） */
        if (entry.name === "user") continue;
        const subFlow = readFlow(join(objectsDir, entry.name));
        if (subFlow) {
          flow.messages = mergeMessages(flow.messages, subFlow.messages);
          subFlows.push({
            stoneName: subFlow.stoneName,
            status: subFlow.status,
            process: subFlow.process,
          });
        }
      }
      /* 兼容：如果 main flow 是 user，用第一个 sub-flow 的状态 */
      if (flow.stoneName === "user" && subFlows.length > 0) {
        flow.status = subFlows[0]!.status as FlowStatus;
      }
    }

    return json({ success: true, data: { flow, subFlows } });
  }

  /* PATCH /api/flows/:sessionId — 更新 Flow 元数据（如 title） */
  if (method === "PATCH" && flowDetailMatch) {
    const sessionId = flowDetailMatch[1]!;
    const sessionDir = join(world.flowsDir, sessionId);
    /* 新结构优先 */
    let flowDir = join(sessionDir, "objects", "user");
    let flow = readFlow(flowDir);
    if (!flow) {
      flowDir = sessionDir;
      flow = readFlow(flowDir);
    }
    if (!flow) return errorResponse(`Flow "${sessionId}" 不存在`, 404);

    const body = await req.json() as Record<string, unknown>;
    if (typeof body.title === "string") {
      flow.title = body.title;
    }

    const dataPath = join(flowDir, "data.json");
    writeFileSync(dataPath, JSON.stringify(flow, null, 2));
    return json({ success: true, data: { flow } });
  }

  /* DELETE /api/flows/:sessionId — 取消卡住的 Flow */
  if (method === "DELETE" && flowDetailMatch) {
    const sessionId = flowDetailMatch[1]!;
    const sessionDir = join(world.flowsDir, sessionId);

    /* 遍历 session 下所有 sub-flow，将 running 状态改为 failed */
    const objectsSubDir = join(sessionDir, "objects");
    let cancelled = 0;
    const cancelFlow = (dir: string) => {
      const flow = readFlow(dir);
      if (flow && (flow.status === "running" || flow.status === "waiting")) {
        flow.status = "failed";
        flow.updatedAt = Date.now();
        flow.messages.push({
          direction: "in" as const,
          from: "system",
          to: flow.stoneName ?? "unknown",
          content: "[系统] Flow 被用户手动取消",
          timestamp: Date.now(),
        });
        writeFileSync(join(dir, "data.json"), JSON.stringify(flow, null, 2));
        cancelled++;
      }
    };

    /* 取消 main flow */
    const mainFlowDir = join(objectsSubDir, "user");
    cancelFlow(mainFlowDir);
    if (!existsSync(mainFlowDir)) cancelFlow(sessionDir);

    /* 取消所有 sub-flows */
    if (existsSync(objectsSubDir)) {
      for (const entry of readdirSync(objectsSubDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== "user") {
          cancelFlow(join(objectsSubDir, entry.name));
        }
      }
    }

    return json({ success: true, data: { sessionId, cancelled } });
  }

  /* GET /api/flows — 获取 Flow 列表 */
  if (method === "GET" && path === "/api/flows") {
    const sessions = getSessionsSummary(world.flowsDir);
    return json({ success: true, data: { sessions } });
  }

  /* PATCH /api/sessions/:sessionId — 更新 session title */
  const sessionPatchMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (method === "PATCH" && sessionPatchMatch) {
    const sessionId = sessionPatchMatch[1]!;
    const sessionDir = join(world.flowsDir, sessionId);
    if (!existsSync(sessionDir)) return errorResponse(`Session "${sessionId}" 不存在`, 404);

    const body = await req.json() as Record<string, unknown>;
    const sessionFile = join(sessionDir, ".session.json");
    const existing = existsSync(sessionFile)
      ? JSON.parse(readFileSync(sessionFile, "utf-8"))
      : {};
    if (typeof body.title === "string") {
      existing.title = body.title;
    }
    writeFileSync(sessionFile, JSON.stringify(existing, null, 2));
    return json({ success: true, data: existing });
  }

  /* ========== Files 文件 ========== */

  /* GET /api/stones/:name/files — 列出对象的 files 文件 */
  const filesListMatch = path.match(/^\/api\/stones\/([^/]+)\/files$/);
  if (method === "GET" && filesListMatch) {
    const name = filesListMatch[1]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);
    const filesDir = join(stone.dir, "files");
    const files = listFilesInDir(filesDir);
    return json({ success: true, data: { files } });
  }

  /* GET /api/stones/:name/files/* — 读取单个 files 文件 */
  const filesFileMatch = path.match(/^\/api\/stones\/([^/]+)\/files\/(.+)$/);
  if (method === "GET" && filesFileMatch) {
    const name = filesFileMatch[1]!;
    const filename = decodeURIComponent(filesFileMatch[2]!);
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);
    const filePath = join(stone.dir, "files", filename);
    if (!existsSync(filePath)) return errorResponse(`文件 "${filename}" 不存在`, 404);
    /* 安全检查：防止路径穿越 */
    const filesDir = join(stone.dir, "files");
    if (!filePath.startsWith(filesDir)) return errorResponse("非法路径", 403);
    const content = readFileSync(filePath, "utf-8");
    return json({ success: true, data: { name: filename, content } });
  }

  /* ========== 文件树 API ========== */

  /* GET /api/tree — 返回 user 根目录的文件树 */
  if (method === "GET" && path === "/api/tree") {
    const tree = buildFileTree(world.rootDir, "", 6);
    return json({ success: true, data: tree });
  }

  /* GET /api/tree/file?path=xxx — 读取 user 根目录下指定相对路径的文件内容 */
  if (method === "GET" && path === "/api/tree/file") {
    const url = new URL(req.url);
    const relPath = url.searchParams.get("path");
    if (!relPath) return errorResponse("缺少 path 参数");
    /* 安全检查：禁止路径穿越 */
    if (relPath.includes("..")) return errorResponse("非法路径", 403);
    const absPath = join(world.rootDir, relPath);
    if (!absPath.startsWith(world.rootDir)) return errorResponse("非法路径", 403);
    if (!existsSync(absPath)) return errorResponse("文件不存在", 404);
    const stat = statSync(absPath);
    if (stat.isDirectory()) return errorResponse("路径是目录，不是文件", 400);
    const content = readFileSync(absPath, "utf-8");
    return json({ success: true, data: { path: relPath, content, size: stat.size } });
  }

  /* PUT /api/tree/file — 写入 user 根目录下指定相对路径的文件内容 */
  if (method === "PUT" && path === "/api/tree/file") {
    const body = await req.json() as Record<string, unknown>;
    const relPath = body.path as string;
    const content = body.content as string;
    if (!relPath || typeof content !== "string") return errorResponse("缺少 path 或 content 参数");
    if (relPath.includes("..")) return errorResponse("非法路径", 403);
    const absPath = join(world.rootDir, relPath);
    if (!absPath.startsWith(world.rootDir)) return errorResponse("非法路径", 403);
    writeFileSync(absPath, content, "utf-8");
    return json({ success: true, data: { path: relPath } });
  }

  /* GET /api/flows/:sessionId/tree — 返回指定 session 目录的文件树 */
  const flowTreeMatch = path.match(/^\/api\/flows\/([^/]+)\/tree$/);
  if (method === "GET" && flowTreeMatch) {
    const sessionId = flowTreeMatch[1]!;
    const sessionDir = join(world.flowsDir, sessionId);
    if (!existsSync(sessionDir)) return errorResponse("Session 不存在", 404);
    const tree = buildFileTree(sessionDir, `flows/${sessionId}`, 6);
    return json({ success: true, data: tree });
  }

  /* GET /api/stones/:name/tree — 返回指定 stone 目录的文件树 */
  const stoneTreeMatch = path.match(/^\/api\/stones\/([^/]+)\/tree$/);
  if (method === "GET" && stoneTreeMatch) {
    const name = stoneTreeMatch[1]!;
    const stoneDir = join(world.rootDir, "stones", name);
    if (!existsSync(stoneDir)) return errorResponse("Stone 不存在", 404);
    const tree = buildFileTree(stoneDir, `stones/${name}`, 6);
    return json({ success: true, data: tree });
  }

  /* ========== ooc:// 协议解析 ========== */

  /* GET /api/resolve?url=ooc://... — 解析 ooc:// URL */
  if (method === "GET" && path === "/api/resolve") {
    const url = new URL(req.url);
    const oocUrl = url.searchParams.get("url");
    if (!oocUrl) return errorResponse("缺少 url 参数");
    return handleOocResolve(oocUrl, world);
  }

  /* ========== 定时任务 ========== */

  /* GET /api/schedules — 列出所有定时任务 */
  if (method === "GET" && (path === "/api/schedules" || path === "/api/cron")) {
    return json({ success: true, data: world.cron.list() });
  }

  /* POST /api/schedules — 创建定时任务（一次性，在指定时间给对象发消息） */
  if (method === "POST" && (path === "/api/schedules" || path === "/api/cron")) {
    const body = (await req.json()) as Record<string, unknown>;
    const target = (body.objectName ?? body.target) as string;
    const message = body.message as string;
    const triggerAt = body.triggerAt as number;
    const createdBy = (body.createdBy as string) ?? "human";

    if (!target || !message || !triggerAt) {
      return errorResponse("缺少必要字段。用法: { objectName: string, message: string, triggerAt: number (Unix ms) }");
    }

    const id = world.cron.schedule(target, message, triggerAt, createdBy);
    return json({ success: true, data: { id, objectName: target, triggerAt: new Date(triggerAt).toISOString() } });
  }

  /* DELETE /api/schedules/:id — 取消定时任务 */
  const scheduleDeleteMatch = path.match(/^\/api\/(?:schedules|cron)\/([^/]+)$/);
  if (method === "DELETE" && scheduleDeleteMatch) {
    const id = scheduleDeleteMatch[1]!;
    const ok = world.cron.cancel(id);
    if (!ok) return errorResponse(`定时任务 "${id}" 不存在`, 404);
    return json({ success: true });
  }

  /* GET /api/stones/:name — 获取对象详情（放在子路由之后匹配） */
  const objectDetailMatch = path.match(/^\/api\/stones\/([^/]+)$/);
  if (method === "GET" && objectDetailMatch) {
    const name = objectDetailMatch[1]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);
    return json({ success: true, data: { ...stone.toJSON(), paused: world.isObjectPaused(name) } });
  }

  /* ========== 飞书 Webhook ========== */

  /* POST /api/webhook/feishu — 飞书事件回调 */
  if (method === "POST" && path === "/api/webhook/feishu") {
    const body = (await req.json()) as Record<string, unknown>;

    // URL 验证（飞书首次配置回调时发送）
    if (body.type === "url_verification") {
      return json({ challenge: body.challenge });
    }

    // 消息事件
    const header = body.header as Record<string, unknown> | undefined;
    const event = body.event as Record<string, unknown> | undefined;

    if (header?.event_type === "im.message.receive_v1" && event) {
      const message = event.message as Record<string, unknown> | undefined;
      const sender = event.sender as Record<string, unknown> | undefined;
      const msgType = message?.message_type as string;
      const senderId = (sender?.sender_id as Record<string, unknown>)?.open_id as string;

      let content = "";
      if (msgType === "text") {
        try {
          content = JSON.parse(message?.content as string).text;
        } catch {
          content = (message?.content as string) ?? "";
        }
      } else {
        content = `[${msgType}] ${message?.content ?? ""}`;
      }

      const targetObject = "nexus";
      const from = `feishu:${senderId ?? "unknown"}`;

      try {
        await world.talk(targetObject, content, from);
        consola.info(`[Feishu] ${from} → ${targetObject}: ${content.slice(0, 50)}`);
      } catch (e) {
        consola.error(`[Feishu] 消息投递失败:`, (e as Error).message);
      }
    }

    return json({ success: true });
  }

  /* ========== Kanban（Session Issues / Tasks） ========== */

  /* POST /api/sessions/:sessionId/issues — 创建 Issue */
  const createIssueMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues$/);
  if (method === "POST" && createIssueMatch) {
    const [, sessionId] = createIssueMatch;
    const body = (await req.json()) as { title?: string; description?: string; participants?: string[] };
    if (!body.title) return errorResponse("title is required");

    const sessionDir = join(world.flowsDir, sessionId!);
    const { createIssue } = await import("../kanban/methods.js");
    const issue = await createIssue(sessionDir, body.title, body.description, body.participants);
    return json({ success: true, data: issue });
  }

  /* POST /api/sessions/:sessionId/tasks — 创建 Task */
  const createTaskMatch = path.match(/^\/api\/sessions\/([^/]+)\/tasks$/);
  if (method === "POST" && createTaskMatch) {
    const [, sessionId] = createTaskMatch;
    const body = (await req.json()) as { title?: string; description?: string; issueRefs?: string[] };
    if (!body.title) return errorResponse("title is required");

    const sessionDir = join(world.flowsDir, sessionId!);
    const { createTask } = await import("../kanban/methods.js");
    const task = await createTask(sessionDir, body.title, body.description, body.issueRefs);
    return json({ success: true, data: task });
  }

  /* POST /api/sessions/:sessionId/issues/:issueId/comments — 用户评论 */
  const issueCommentMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues\/([^/]+)\/comments$/);
  if (method === "POST" && issueCommentMatch) {
    const [, sessionId, issueId] = issueCommentMatch;
    const body = (await req.json()) as { content?: string; mentions?: string[] };
    if (!body.content) return errorResponse("content is required");

    const sessionDir = join(world.flowsDir, sessionId!);
    const { commentOnIssue } = await import("../kanban/discussion.js");
    const result = await commentOnIssue(sessionDir, issueId!, "user", body.content, body.mentions);
    return json({ success: true, data: result.comment });
  }

  /* POST /api/sessions/:sessionId/issues/:issueId/ack — 清除 issue hasNewInfo */
  const issueAckMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues\/([^/]+)\/ack$/);
  if (method === "POST" && issueAckMatch) {
    const [, sessionId, issueId] = issueAckMatch;
    const sessionDir = join(world.flowsDir, sessionId!);
    const { setIssueNewInfo } = await import("../kanban/methods.js");
    await setIssueNewInfo(sessionDir, issueId!, false);
    return json({ success: true });
  }

  /* POST /api/sessions/:sessionId/tasks/:taskItemId/ack — 清除 task hasNewInfo */
  const taskAckMatch = path.match(/^\/api\/sessions\/([^/]+)\/tasks\/([^/]+)\/ack$/);
  if (method === "POST" && taskAckMatch) {
    const [, sessionId, taskItemId] = taskAckMatch;
    const sessionDir = join(world.flowsDir, sessionId!);
    const { setTaskNewInfo } = await import("../kanban/methods.js");
    await setTaskNewInfo(sessionDir, taskItemId!, false);
    return json({ success: true });
  }

  /* 404 */
  return errorResponse(`未知路由: ${method} ${path}`, 404);
}

/* ========== SSE 处理 ========== */

/**
 * 创建 SSE 响应
 *
 * 使用 ReadableStream 持续推送事件。
 * 客户端断开时自动清理监听器。
 */
function handleSSE(): Response {
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

/* ========== 数据查询辅助函数 ========== */

/** Trait 信息（前端展示用） */
interface TraitInfo {
  name: string;
  when: string;
  readme: string;
  hasMethods: boolean;
  methods: { name: string; description: string }[];
}

/**
 * 获取对象的 traits 详情（对象自身 + kernel）
 */
async function getTraitsInfo(
  objectDir: string,
  worldRootDir: string,
): Promise<{ traits: TraitInfo[]; kernelTraits: TraitInfo[] }> {
  const objectTraitsDir = join(objectDir, "traits");
  const kernelTraitsDir = join(worldRootDir, "kernel", "traits");

  const loadTraitInfos = async (dir: string): Promise<TraitInfo[]> => {
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const infos: TraitInfo[] = [];
    for (const name of names) {
      const trait = await loadTrait(join(dir, name), name);
      if (trait) {
        infos.push({
          name: trait.name,
          when: trait.when,
          readme: trait.readme,
          hasMethods: trait.methods.length > 0,
          methods: trait.methods.map((m) => ({ name: m.name, description: m.description })),
        });
      }
    }
    return infos;
  };

  return {
    traits: await loadTraitInfos(objectTraitsDir),
    kernelTraits: await loadTraitInfos(kernelTraitsDir),
  };
}

/**
 * 获取 sessions 摘要列表（从顶层 flows/ 目录读取）
 */
function getSessionsSummary(flowsDir: string): Array<{
  sessionId: string;
  title?: string;
  status: FlowStatus;
  firstMessage: string;
  messageCount: number;
  actionCount: number;
  hasProcess: boolean;
  createdAt: number;
  updatedAt: number;
}> {
  const sessionIds = listFlowSessions(flowsDir);
  const summaries: Array<{
    sessionId: string;
    title?: string;
    status: FlowStatus;
    firstMessage: string;
    messageCount: number;
    actionCount: number;
    hasProcess: boolean;
    createdAt: number;
    updatedAt: number;
  }> = [];

  for (const sessionId of sessionIds) {
    /* 新结构：session/flows/user/ */
    let flow = readFlow(join(flowsDir, sessionId, "objects", "user"));
    if (!flow) {
      /* 兼容旧数据：session 根目录 */
      flow = readFlow(join(flowsDir, sessionId));
    }
    if (!flow) continue;

    /* 读取 .session.json 中的 title（优先于 flow.title） */
    let sessionTitle = flow.title;
    const sessionFile = join(flowsDir, sessionId, ".session.json");
    if (existsSync(sessionFile)) {
      try {
        const meta = JSON.parse(readFileSync(sessionFile, "utf-8"));
        if (typeof meta.title === "string") sessionTitle = meta.title;
      } catch { /* 忽略解析错误 */ }
    }

    const firstIn = flow.messages.find((m) => m.direction === "in");
    summaries.push({
      sessionId: flow.sessionId,
      title: sessionTitle,
      status: flow.status,
      firstMessage: firstIn?.content ?? "",
      messageCount: flow.messages.length,
      actionCount: collectAllActions(flow.process.root).length,
      hasProcess: true,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    });
  }

  /* 按更新时间倒序 */
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

/**
 * 合并两个 Flow 的消息列表，按时间排序并去重
 */
function mergeMessages(a: FlowMessage[], b: FlowMessage[]): FlowMessage[] {
  const seen = new Set<string>();
  const all = [...a, ...b];
  const deduped: FlowMessage[] = [];

  for (const msg of all) {
    const key = `${msg.from}:${msg.to}:${msg.timestamp}:${msg.content.slice(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(msg);
    }
  }

  deduped.sort((x, y) => x.timestamp - y.timestamp);
  return deduped;
}

/* ========== 文件树辅助函数 ========== */

/** 文件树节点 */
interface FileTreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  size?: number;
  children?: FileTreeNode[];
  /** 目录标记：stone 或 flow（目录下存在 .stone 或 .flow 文件时设置） */
  marker?: "stone" | "flow";
}

/** 需要从文件树中隐藏的标记文件 */
const MARKER_FILES = new Set([".stone", ".flow"]);

/**
 * 递归构建文件树 JSON
 *
 * @param absDir - 要扫描的绝对路径
 * @param relativePath - 相对于 user 根目录的路径前缀
 * @param maxDepth - 最大递归深度（防止过深）
 */
function buildFileTree(absDir: string, relativePath: string, maxDepth = 8): FileTreeNode | null {
  if (!existsSync(absDir) || maxDepth <= 0) return null;

  const stat = statSync(absDir);
  const name = absDir.split("/").pop()!;

  if (!stat.isDirectory()) {
    return { name, type: "file", path: relativePath, size: stat.size };
  }

  const entries = readdirSync(absDir, { withFileTypes: true });
  const children: FileTreeNode[] = [];

  /* 检测目录标记 */
  let marker: "stone" | "flow" | undefined;
  if (existsSync(join(absDir, ".stone"))) marker = "stone";
  else if (existsSync(join(absDir, ".flow"))) marker = "flow";

  for (const entry of entries) {
    /* 隐藏标记文件 */
    if (MARKER_FILES.has(entry.name)) continue;

    const childAbs = join(absDir, entry.name);
    const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const subtree = buildFileTree(childAbs, childRel, maxDepth - 1);
      if (subtree) children.push(subtree);
    } else {
      const s = statSync(childAbs);
      children.push({ name: entry.name, type: "file", path: childRel, size: s.size });
    }
  }

  /* 目录排前，文件排后，各自按名称排序 */
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const node: FileTreeNode = { name, type: "directory", path: relativePath, children };
  if (marker) node.marker = marker;
  return node;
}

/* ========== Files 文件辅助函数 ========== */

/** 文件信息 */
interface FileInfo {
  name: string;
  size: number;
  modifiedAt: number;
}

/**
 * 递归列出 files 目录下的所有文件
 */
function listFilesInDir(filesDir: string, prefix = ""): FileInfo[] {
  if (!existsSync(filesDir)) return [];
  const entries = readdirSync(filesDir, { withFileTypes: true });
  const files: FileInfo[] = [];

  for (const entry of entries) {
    const entryPath = join(filesDir, entry.name);
    const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFilesInDir(entryPath, relativeName));
    } else {
      const stat = statSync(entryPath);
      files.push({
        name: relativeName,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    }
  }

  return files;
}

/**
 * 解析 ooc:// URL 并返回对应数据
 */
function handleOocResolve(oocUrl: string, world: World): Response {
  /* ooc://object/{name} 或 ooc://stone/{name} */
  const objectMatch = oocUrl.match(/^ooc:\/\/(?:object|stone)\/([^/]+)$/);
  if (objectMatch) {
    const name = objectMatch[1]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);
    return json({ success: true, data: { type: "object", ...stone.toJSON() } });
  }

  /* ooc://file/objects/{name}/files/{path} 或 ooc://file/stones/{name}/files/{path}（兼容旧 shared 路径） */
  const fileMatch = oocUrl.match(/^ooc:\/\/file\/(?:objects|stones)\/([^/]+)\/(?:files|shared)\/(.+)$/);
  if (fileMatch) {
    const objectName = fileMatch[1]!;
    const filename = decodeURIComponent(fileMatch[2]!);
    const stone = world.getObject(objectName);
    if (!stone) return errorResponse(`对象 "${objectName}" 不存在`, 404);
    /* 优先查找 files/ 目录，fallback 到 stone 根目录 */
    let filePath = join(stone.dir, "files", filename);
    let baseDir = join(stone.dir, "files");
    if (!existsSync(filePath)) {
      filePath = join(stone.dir, filename);
      baseDir = stone.dir;
    }
    if (!existsSync(filePath)) return errorResponse(`文件 "${filename}" 不存在`, 404);
    /* 安全检查 */
    if (!filePath.startsWith(baseDir)) return errorResponse("非法路径", 403);
    const content = readFileSync(filePath, "utf-8");
    return json({ success: true, data: { type: "file", objectName, filename, content } });
  }

  return errorResponse(`无法解析 ooc:// URL: ${oocUrl}`);
}
