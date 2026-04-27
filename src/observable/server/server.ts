/**
 * HTTP 服务器
 *
 * 提供 OOC 系统的 HTTP API + SSE 实时事件推送。
 * 使用 Bun 原生 HTTP 服务器。
 *
 * @ref docs/哲学文档/gene.md#G11 — references — 前端通过 API 获取对象数据进行 UI 渲染
 * @ref src/world/world.ts — references — World 根对象（API 操作入口）
 * @ref src/observable/server/events.ts — references — SSE 事件总线
 */

import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { consola } from "consola";
import { eventBus, type SSEEvent } from "./events.js";
import { readFlow, listFlowSessions, readUserInbox, setUserReadObject } from "../../storable/index.js";
import {
  readEditPlan,
  previewEditPlan,
  applyEditPlan,
  cancelEditPlan,
} from "../../storable/edit-plans/edit-plans.js";
import { collectAllActions, createProcess } from "../../storable/thread/process-compat.js";
import { loadTrait } from "../../extendable/trait/loader.js";
import { threadsToProcess } from "../../storable/thread/thread-adapter.js";
import type { World } from "../../world/index.js";
import type { FlowStatus, FlowMessage, Process, ProcessNode, Action, FlowData } from "../../shared/types/index.js";

/**
 * 动态摘要最大字符长度（超过截断追加省略号）
 *
 * 与迭代文档 `docs/工程管理/迭代/all/20260422_feature_running_session_摘要.md`
 * 约定的"限长 50 字符"对齐。
 */
const CURRENT_ACTION_MAX_LEN = 50;

/**
 * 从 Process 计算一句话"当前动作"摘要
 *
 * 仅用于 running session 在前端（SessionKanban）做"正在做什么"的动态提示。
 *
 * 优先级（与迭代文档 Phase 1 一致）：
 * 1. 最新 thinking action 的首句
 * 2. 最新 tool_use action 的 title
 * 3. 最新 action 的类型名
 *
 * 遍历策略：递归收集所有节点 actions → 按 timestamp 降序 → 按优先级挑选。
 *
 * @returns 50 字符以内的摘要；数据不足时返回 undefined（前端显示 fallback）
 */
function computeCurrentAction(process: Process | undefined | null): string | undefined {
  if (!process?.root) return undefined;

  /* 递归把所有 action 收进一个数组（不可变）——每个节点的 actions 本身保序，
     跨节点则按 timestamp 全局排序。 */
  const all: Action[] = [];
  const walk = (node: ProcessNode): void => {
    for (const a of node.actions ?? []) all.push(a);
    for (const child of node.children ?? []) walk(child);
  };
  walk(process.root);

  if (all.length === 0) return undefined;

  /* 降序按 timestamp，保证"最新"语义；copy 不改原数据。 */
  const sorted = [...all].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  /* 优先级 1：最新 thinking 首句（首个换行之前） */
  const latestThinking = sorted.find((a) => a.type === "thinking" && typeof a.content === "string" && a.content.trim().length > 0);
  if (latestThinking) {
    const firstLine = latestThinking.content.split(/\r?\n/)[0]!.trim();
    if (firstLine) return truncate(firstLine, CURRENT_ACTION_MAX_LEN);
  }

  /* 优先级 2：最新 tool_use 的 title */
  const latestToolUse = sorted.find((a) => a.type === "tool_use" && typeof a.title === "string" && a.title.trim().length > 0);
  if (latestToolUse && latestToolUse.title) {
    return truncate(latestToolUse.title.trim(), CURRENT_ACTION_MAX_LEN);
  }

  /* 优先级 3：最新 action 的类型名（兜底——有 name 的用 name，否则用 type） */
  const latest = sorted[0];
  if (latest) {
    const label = latest.name && latest.name.trim() ? latest.name.trim() : latest.type;
    return truncate(label, CURRENT_ACTION_MAX_LEN);
  }

  return undefined;
}

/** 截断到 max 字符，超出补 `…`（不折中英文，简化实现） */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * 根据对象的 threads.json 推断实时 Flow 状态
 *
 * 背景：线程树架构下，engine 仅在执行完成后才写 objects/{name}/data.json；
 * 执行过程中 data.json 的 status 可能还是上一次 finish 值。
 * 但 threads.json 是**每次 action 都增量更新**的（tree.writeThreadData），
 * 因此优先读 threads.json 判断当前是否还有 running/waiting 节点——
 * 有则 override subFlow.status 为 "running"，让前端 SessionKanban 的
 * "正在 XX" 提示能在 running 期间可靠显示。
 *
 * @param objectFlowDir - flows/{sessionId}/objects/{objectName} 目录
 * @param dataStatus - data.json 中原始 status（作为 fallback）
 * @returns 合成后的 FlowStatus
 */
function inferLiveFlowStatus(objectFlowDir: string, dataStatus: FlowStatus): FlowStatus {
  const treePath = join(objectFlowDir, "threads.json");
  if (!existsSync(treePath)) return dataStatus;
  try {
    const tree = JSON.parse(readFileSync(treePath, "utf-8")) as {
      rootId?: string;
      nodes?: Record<string, { status?: string }>;
    };
    if (!tree.nodes) return dataStatus;
    /* 有任何 running/waiting 节点 → 认为 flow 还在活跃 */
    for (const node of Object.values(tree.nodes)) {
      if (node.status === "running" || node.status === "waiting") {
        return "running";
      }
    }
    return dataStatus;
  } catch {
    return dataStatus;
  }
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
 *
 * export 以便单元测试直接调用（无需真起 Bun.serve）。
 */
export async function handleRoute(
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

  /* POST /api/sessions/create — 预创建 session，立即返回 sessionId */
  if (method === "POST" && path === "/api/sessions/create") {
    const body = (await req.json()) as Record<string, unknown>;
    const objectName = (body.objectName as string) ?? "supervisor";
    const stone = world.getObject(objectName);
    if (!stone) return errorResponse(`对象 "${objectName}" 不存在`, 404);

    const sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionDir = join(world.flowsDir, sessionId);
    const objectFlowDir = join(sessionDir, "objects", objectName);
    mkdirSync(objectFlowDir, { recursive: true });
    /* 写入 .session.json 标记 */
    writeFileSync(join(sessionDir, ".session.json"), JSON.stringify({ title: "" }, null, 2));
    /* 预创建 kanban 空文件，避免前端 404 */
    const issuesDir = join(sessionDir, "issues");
    const tasksDir = join(sessionDir, "tasks");
    mkdirSync(issuesDir, { recursive: true });
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(join(issuesDir, "index.json"), "[]");
    writeFileSync(join(tasksDir, "index.json"), "[]");
    writeFileSync(join(sessionDir, "readme.md"), "");

    return json({ success: true, data: { sessionId } }, 201);
  }

  /* POST /api/talk/:objectName — 向对象发消息（异步，不等待执行完成）
   *
   * 可选 body 字段 formResponse：对某个 form 的结构化回复
   *   { formId: string, selectedOptionIds: string[], freeText: string | null }
   * 若提供，服务端会把结构化信息以 [formResponse] 前缀注入消息体，
   * 让目标对象的 LLM 能明确区分「用户点选了 X/Y」vs「用户写了自由文本」。
   */
  const talkMatch = path.match(/^\/api\/talk\/([^/]+)$/);
  if (method === "POST" && talkMatch) {
    const objectName = talkMatch[1]!;
    const body = (await req.json()) as Record<string, unknown>;
    const message = body.message as string;
    const flowId = (body.sessionId ?? body.flowId) as string | undefined;
    const formResponseRaw = body.formResponse;
    if (!message && formResponseRaw == null) return errorResponse("缺少 message 字段");

    /* 检查对象是否存在 */
    if (!world.registry.get(objectName)) {
      return errorResponse(`对象 "${objectName}" 不存在`, 404);
    }

    /* 标准化 formResponse（宽容校验：字段缺失视为未提供） */
    let formResponsePrefix = "";
    if (formResponseRaw && typeof formResponseRaw === "object") {
      const fr = formResponseRaw as Record<string, unknown>;
      const formId = typeof fr.formId === "string" ? fr.formId : null;
      const selectedOptionIds = Array.isArray(fr.selectedOptionIds)
        ? fr.selectedOptionIds.filter((x): x is string => typeof x === "string")
        : [];
      const freeText = typeof fr.freeText === "string" ? fr.freeText : null;
      if (formId) {
        /* 结构化前缀：LLM 凭此知道用户点了哪个选项 / 写了什么文字
         * 单行 JSON 方便 LLM 机读；同时前端用户输入的 message 会作为人类可读部分展示在前缀之后 */
        const payload = JSON.stringify({ formId, selectedOptionIds, freeText });
        formResponsePrefix = `[formResponse] ${payload}\n\n`;
      }
    }

    const finalMessage = formResponsePrefix + (message ?? "");

    /* 未提供 sessionId 时自动生成，确保 HTTP 响应能返回 */
    const sessionId = flowId ?? `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    /* 异步执行，不阻塞 HTTP 响应 */
    world.talk(objectName, finalMessage, "user", sessionId).catch((e) => {
      const errMsg = (e as Error).message;
      consola.error(`[Server] talk 异步执行失败: ${errMsg}`);
      /* 将失败写入 data.json，让 /api/flows 能感知此 session 的失败状态 */
      try {
        const now = Date.now();
        const objectFlowDir = join(world.flowsDir, sessionId, "objects", objectName);
        mkdirSync(objectFlowDir, { recursive: true });
        const failedFlow: FlowData = {
          sessionId,
          stoneName: objectName,
          title: "(talk failed before engine start)",
          status: "failed",
          failureReason: errMsg,
          messages: [],
          process: createProcess("task"),
          data: {},
          createdAt: now,
          updatedAt: now,
        };
        writeFileSync(join(objectFlowDir, "data.json"), JSON.stringify(failedFlow, null, 2));
      } catch (writeErr) {
        consola.error(`[Server] 写失败 flow 记录失败: ${(writeErr as Error).message}`);
      }
    });

    return json({
      success: true,
      data: {
        sessionId,
        status: "running",
      },
    });
  }

  /* POST /api/flows/:sid/objects/:name/call_method — 用户从 View 调用 ui_method（Phase 4）
   *
   * 白名单严格：
   *   - traitId 必须是 self: namespace
   *   - 目标 trait 的 kind 必须是 "view"
   *   - method 必须在 ui_methods（不看 llm_methods）
   *   - view 必须属于路径参数 :name 指向的对象（由 loader 隐式保证 + 此处显式再查）
   * 副作用：
   *   - 方法可通过 ctx.notifyThread(msg) 向该对象的根线程 inbox 写 system 消息
   *     若根线程状态为 done，自动复活；若 flow 处于 sleep 状态，world.resumeFlow 非阻塞触发
   *
   * @ref docs/superpowers/specs/2026-04-21-trait-namespace-views-and-http-methods-design.md#4.6
   */
  const callMethodMatch = path.match(/^\/api\/flows\/([^/]+)\/objects\/([^/]+)\/call_method$/);
  if (method === "POST" && callMethodMatch) {
    const sid = callMethodMatch[1]!;
    const objectName = callMethodMatch[2]!;
    const body = (await req.json()) as Record<string, unknown>;
    const traitId = body.traitId;
    const methodName = body.method;
    const args = (body.args ?? {}) as Record<string, unknown>;

    /* 参数校验 */
    if (typeof traitId !== "string" || !traitId) {
      return errorResponse("缺少 traitId 字段", 400);
    }
    if (typeof methodName !== "string" || !methodName) {
      return errorResponse("缺少 method 字段", 400);
    }
    if (!traitId.startsWith("self:")) {
      return errorResponse("只允许调用 self: namespace 的 traitId", 403);
    }

    /* 对象存在性校验 */
    const stone = world.registry.get(objectName);
    if (!stone) return errorResponse(`对象 "${objectName}" 不存在`, 404);

    /* 加载该对象的全部 self traits + views（kernel/library 不参与 HTTP call_method） */
    const { loadObjectViews, loadTraitsFromDir } = await import("../../extendable/trait/loader.js");
    const stoneViews = await loadObjectViews(stone.dir);
    const flowObjectDir = join(world.rootDir, "flows", sid, "objects", objectName);
    const flowViews = existsSync(flowObjectDir) ? await loadObjectViews(flowObjectDir) : [];
    const selfTraits = existsSync(join(stone.dir, "traits"))
      ? await loadTraitsFromDir(join(stone.dir, "traits"), "self")
      : [];
    /* 合并 self 命名空间下可见条目（flow view 覆盖 stone view 覆盖 trait） */
    const selfMap = new Map<string, typeof stoneViews[number]>();
    for (const t of selfTraits) selfMap.set(`${t.namespace}:${t.name}`, t);
    for (const v of stoneViews) selfMap.set(`${v.namespace}:${v.name}`, v);
    for (const v of flowViews) selfMap.set(`${v.namespace}:${v.name}`, v);
    const view = selfMap.get(traitId);
    if (!view) {
      return errorResponse(`trait "${traitId}" 不属于对象 "${objectName}"（或不存在）`, 404);
    }
    /* kind=view 校验：self: namespace 的普通 trait 不可通过 HTTP 调用 */
    if (view.kind !== "view") {
      return errorResponse(`traitId "${traitId}" 不是 kind=view（实际 ${view.kind}），HTTP 只允许调用 view`, 403);
    }

    /* ui_methods 白名单 */
    const uiMethod = view.uiMethods?.[methodName];
    if (!uiMethod) {
      const available = Object.keys(view.uiMethods ?? {});
      return errorResponse(
        `方法 "${methodName}" 未在 ${traitId} 的 ui_methods 中声明（可用：${available.join(", ") || "无"}）`,
        403,
      );
    }

    /* 构造 MethodContext，含 notifyThread（写入根线程 inbox + 唤醒 done 线程 + 非阻塞 resume） */
    const { ThreadsTree } = await import("../../thinkable/thread-tree/tree.js");
    const objFlowDir = join(world.rootDir, "flows", sid, "objects", objectName);
    const tree = existsSync(objFlowDir) ? ThreadsTree.load(objFlowDir) : null;

    const notifyThread = (content: string, opts?: { from?: string }) => {
      if (!tree) {
        consola.warn(`[call_method] notifyThread: 无线程树（flow ${sid}/${objectName}），跳过`);
        return;
      }
      const rootId = tree.rootId;
      const rootNodeBefore = tree.getNode(rootId);
      const needsRevival = rootNodeBefore?.status === "done";
      tree.writeInbox(rootId, {
        from: opts?.from ?? "ui",
        content,
        source: "system",
      });
      /* 若 root 线程由 done 被复活，触发 resumeFlow（非阻塞，不等待 LLM 完成） */
      if (needsRevival) {
        world.resumeFlow(objectName, sid).catch((e) => {
          consola.error(`[call_method] resumeFlow 失败: ${(e as Error).message}`);
        });
      }
    };

    const methodCtx = {
      data: { ...stone.data },
      getData: (k: string) => stone.data[k],
      setData: (k: string, v: unknown) => { stone.data[k] = v; },
      print: (...parts: unknown[]) => {
        consola.info(`[call_method/${objectName}]`, ...parts);
      },
      sessionId: sid,
      filesDir: join(objFlowDir, "files"),
      rootDir: world.rootDir,
      selfDir: stone.dir,
      stoneName: objectName,
      notifyThread,
    };

    /* 执行方法 */
    try {
      const result = uiMethod.needsCtx
        ? await uiMethod.fn(methodCtx, args)
        : await uiMethod.fn(args);
      /* data 变更持久化 */
      try {
        stone.save();
      } catch (e) {
        consola.warn(`[call_method] stone.save() 失败: ${(e as Error).message}`);
      }
      return json({ success: true, data: { result } });
    } catch (e) {
      return json({ success: false, error: (e as Error).message }, 500);
    }
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

  /*
   * 说明（2026-04-21 旧 Flow 架构退役）：
   *
   * 原本这里有三个 debug 调试接口：
   *   - GET  /api/stones/:name/flows/:flowId/pending-output
   *   - POST /api/stones/:name/flows/:flowId/step
   *   - POST /api/stones/:name/flows/:flowId/debug-mode
   *
   * 这三个接口只在旧 Flow 架构下工作（依赖 `flow.data._pendingOutput` / `debugMode` 字段）。
   * 线程树架构的 pause/step 调试走文件级：stones/{name}/threads/{id}/llm.input.txt + llm.output.txt，
   * 不存在对应的 JSON 字段，因此上述接口在新架构下永远返回空值，已全部移除。
   * 前端 `FlowDetail.tsx` 的 `PausedPanel` 组件同步删除。
   */

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

  /* GET /api/sessions/:sessionId/objects — 获取 session 中的所有对象 */
  if (method === "GET" && path.startsWith("/api/sessions/") && path.endsWith("/objects")) {
    const sessionId = path.split("/")[3]!;
    const objectsDir = join(world.flowsDir, sessionId, "objects");

    if (!existsSync(objectsDir)) {
      return json({ success: true, data: [] });
    }

    const objects = readdirSync(objectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    // supervisor 排在第一位
    const sorted = objects.sort((a, b) => {
      if (a === "supervisor") return -1;
      if (b === "supervisor") return 1;
      return a.localeCompare(b);
    });

    return json({ success: true, data: sorted });
  }

  /* GET /api/sessions/:sessionId/objects/:objectName/process — 获取对象的 process 数据 */
  if (method === "GET" && path.match(/^\/api\/sessions\/[^/]+\/objects\/[^/]+\/process$/)) {
    const parts = path.split("/");
    const sessionId = parts[3]!;
    const objectName = parts[5]!;
    const objectFlowDir = join(world.flowsDir, sessionId, "objects", objectName);

    if (!existsSync(objectFlowDir)) {
      return json({ success: false, error: "Object not found" }, 404);
    }

    const process = threadsToProcess(objectFlowDir);

    if (!process) {
      return json({ success: false, error: "Process data not available" }, 404);
    }

    return json({ success: true, data: process });
  }

  /* GET /api/flows/:sessionId — 获取单个 Flow 详情 */
  const flowDetailMatch = path.match(/^\/api\/flows\/([^/]+)$/);
  if (method === "GET" && flowDetailMatch) {
    const sessionId = flowDetailMatch[1]!;
    const sessionDir = join(world.flowsDir, sessionId);

    /* 线程树架构下 flow 数据只在 objects/{objectName}/ 下；扫第一个有 data.json 的子目录 */
    let flow = null;
    const objDir = join(sessionDir, "objects");
    if (existsSync(objDir)) {
      const entries = readdirSync(objDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subFlow = readFlow(join(objDir, entry.name));
        if (subFlow) { flow = subFlow; break; }
      }
    }
    if (!flow) {
      /* 兼容旧数据：session 根目录 */
      flow = readFlow(sessionDir);
    }
    if (!flow) {
      /* session 目录存在但 flow 数据尚未写入（竞态：异步执行中）。
         构造一个"占位 flow"让下游 subFlows 聚合逻辑继续执行——
         这样 running session 即便 data.json 还没落盘，前端也能从
         threads.json 合成的 subFlows 拿到 currentAction。 */
      if (existsSync(sessionDir)) {
        const now = Date.now();
        flow = {
          sessionId,
          stoneName: "",
          status: "pending" as FlowStatus,
          messages: [] as FlowMessage[],
          process: { root: { id: "root", title: "task", status: "todo" as const, children: [], actions: [] }, focusId: "root" },
          data: {},
          createdAt: now,
          updatedAt: now,
        } satisfies FlowData;
      } else {
        return errorResponse(`Flow "${sessionId}" 不存在`, 404);
      }
    }

    /* 合并 sub-flow 的消息和 process（让前端能看到完整对话和所有对象的行为树） */
    const objectsDir = join(sessionDir, "objects");
    /* currentAction 为 2026-04-22 新增的追加字段——仅对 running 状态计算，
       给前端 SessionKanban 做"running session 动态摘要"提示。
       此处仅追加，不改动原有三个字段。
       修复 (2026-04-22 bugfix-v3 P1-d)：data.json 执行中不会更新 status；
       通过 inferLiveFlowStatus 从 threads.json 推断活跃状态，让 running 期
       currentAction 能可靠点亮前端 pulse + "正在 X" 文本。 */
    const subFlows: Array<{ stoneName: string; status: FlowStatus; process: unknown; currentAction?: string }> = [];
    if (existsSync(objectsDir)) {
      const subEntries = readdirSync(objectsDir, { withFileTypes: true });
      for (const entry of subEntries) {
        if (!entry.isDirectory()) continue;
        const subFlowDir = join(objectsDir, entry.name);
        const subFlow = readFlow(subFlowDir);
        if (subFlow) {
          flow.messages = mergeMessages(flow.messages, subFlow.messages);
          /* 合成实时 status：优先 threads.json（增量更新），fallback data.json */
          const liveStatus = inferLiveFlowStatus(subFlowDir, subFlow.status);
          /* 仅 running/waiting 计算——finished/failed 已有 node.summary（"一句话任务摘要"），
             不需要再叠一层 currentAction 以免信号混淆。 */
          const currentAction =
            liveStatus === "running" || liveStatus === "waiting"
              ? computeCurrentAction(subFlow.process)
              : undefined;
          subFlows.push({
            stoneName: subFlow.stoneName,
            status: liveStatus,
            process: subFlow.process,
            ...(currentAction ? { currentAction } : {}),
          });
        } else if (existsSync(join(subFlowDir, "threads.json"))) {
          /* 线程树已建但 data.json 尚未写入（engine 仅在 finish 时写 data.json）——
             用 threads.json + threads/ 目录合成一个"临时 subFlow"，
             让 running session 的前端 UI 立即能见到对象行 + 实时 currentAction。 */
          const liveStatus = inferLiveFlowStatus(subFlowDir, "running");
          const process = threadsToProcess(subFlowDir) ?? undefined;
          const currentAction =
            liveStatus === "running" || liveStatus === "waiting"
              ? computeCurrentAction(process)
              : undefined;
          subFlows.push({
            stoneName: entry.name,
            status: liveStatus,
            process,
            ...(currentAction ? { currentAction } : {}),
          });
        }
      }
    }

    /* 若任一 subFlow 活跃（running/waiting），顶层 flow.status 也应反映——
       sessions 列表卡片与 Kanban 的活跃指示都依赖此字段。 */
    if (subFlows.some((s) => s.status === "running" || s.status === "waiting")) {
      flow.status = "running";
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

    /* 旧架构：通过 data.json 取消 */
    const cancelFlow = (dir: string) => {
      const flow = readFlow(dir);
      if (flow && (flow.status === "running" || flow.status === "waiting")) {
        flow.status = "failed";
        flow.failureReason = "用户取消";
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

    /* 线程树架构：通过 threads.json 取消 */
    const cancelThreadTree = (dir: string) => {
      const treePath = join(dir, "threads.json");
      if (!existsSync(treePath)) return;
      try {
        const tree = JSON.parse(readFileSync(treePath, "utf-8"));
        let modified = false;
        for (const nodeId of Object.keys(tree.nodes ?? {})) {
          const node = tree.nodes[nodeId];
          if (node && (node.status === "running" || node.status === "waiting" || node.status === "doing")) {
            node.status = "failed";
            node.updatedAt = Date.now();
            modified = true;
            cancelled++;
          }
        }
        if (modified) {
          writeFileSync(treePath, JSON.stringify(tree, null, 2));
        }
      } catch { /* 解析失败忽略 */ }
    };

    /* 取消 main flow */
    const mainFlowDir = join(objectsSubDir, "user");
    cancelFlow(mainFlowDir);
    if (!existsSync(mainFlowDir)) cancelFlow(sessionDir);

    /* 取消所有 sub-flows（旧架构 + 线程树架构） */
    if (existsSync(objectsSubDir)) {
      for (const entry of readdirSync(objectsSubDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const subDir = join(objectsSubDir, entry.name);
          cancelFlow(subDir);
          cancelThreadTree(subDir);
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
    if (!existsSync(absPath)) {
      /* kanban index 文件不存在时返回空数组（避免前端 404） */
      if (relPath.endsWith("/issues/index.json") || relPath.endsWith("/tasks/index.json")) {
        return json({ success: true, data: { path: relPath, content: "[]", size: 2 } });
      }
      return errorResponse("文件不存在", 404);
    }
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

  /* PUT /api/flows/:sessionId/threads/:threadId/pins — 更新线程图钉 */
  const threadPinsMatch = path.match(/^\/api\/flows\/([^/]+)\/threads\/([^/]+)\/pins$/);
  if (method === "PUT" && threadPinsMatch) {
    const sessionId = threadPinsMatch[1]!;
    const threadId = threadPinsMatch[2]!;
    const body = (await req.json()) as { pins?: string[]; objectName?: string };
    const pins = body.pins ?? [];
    const objectName = body.objectName ?? "supervisor";

    /* 找到 thread.json 并更新 pins */
    const { readThreadsTree, getAncestorPath, readThreadData, writeThreadData, getThreadDir } = await import("../../storable/thread/persistence.js");
    const objectFlowDir = join(world.flowsDir, sessionId, "objects", objectName);
    const tree = readThreadsTree(objectFlowDir);
    if (!tree || !tree.nodes[threadId]) return errorResponse(`Thread "${threadId}" 不存在`, 404);

    const ancestorPath = getAncestorPath(tree, threadId);
    const threadDir = getThreadDir(objectFlowDir, ancestorPath);
    const threadData = readThreadData(threadDir);
    if (!threadData) return errorResponse(`Thread data "${threadId}" 不存在`, 404);

    threadData.pins = pins;
    writeThreadData(threadDir, threadData);
    return json({ success: true, data: { threadId, pins } });
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
    const createdBy = (body.createdBy as string) ?? "user";

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

  /* GET /api/stones/:name/memory/stats — memory 健康度统计（Memory Curation Phase 2 Phase 4） */
  const memoryStatsMatch = path.match(/^\/api\/stones\/([^/]+)\/memory\/stats$/);
  if (method === "GET" && memoryStatsMatch) {
    const name = memoryStatsMatch[1]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);

    const { readMemoryEntries } = await import("../../storable/memory/entries.js");
    const entries = readMemoryEntries(stone.dir);
    const now = Date.now();
    let pinned = 0;
    let totalAgeMs = 0;
    let latestCreatedAt: string | null = null;
    for (const e of entries) {
      if (e.pinned) pinned++;
      const createdMs = new Date(e.createdAt).getTime();
      totalAgeMs += Math.max(0, now - createdMs);
      if (!latestCreatedAt || createdMs > new Date(latestCreatedAt).getTime()) {
        latestCreatedAt = e.createdAt;
      }
    }
    const avgAgeMs = entries.length > 0 ? Math.round(totalAgeMs / entries.length) : 0;
    const lastCuration = world.memoryCurator.getLastStat(name);

    return json({
      success: true,
      data: {
        stoneName: name,
        total: entries.length,
        pinned,
        nonPinned: entries.length - pinned,
        avgAgeMs,
        avgAgeDays: Math.round(avgAgeMs / (24 * 3600 * 1000) * 10) / 10,
        latestCreatedAt,
        lastCuration: lastCuration ?? null,
      },
    });
  }

  /* POST /api/stones/:name/memory/curate — 手动触发一次 curation + GC（Phase 4 UI 辅助） */
  const memoryCurateMatch = path.match(/^\/api\/stones\/([^/]+)\/memory\/curate$/);
  if (method === "POST" && memoryCurateMatch) {
    const name = memoryCurateMatch[1]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);
    const stat = await world.memoryCurator.curateNow(name);
    return json({ success: true, data: stat });
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
    const { createIssue } = await import("../../collaborable/kanban/methods.js");
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
    const { createTask } = await import("../../collaborable/kanban/methods.js");
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
    const { commentOnIssue } = await import("../../collaborable/kanban/discussion.js");
    const result = await commentOnIssue(sessionDir, issueId!, "user", body.content, body.mentions);
    return json({ success: true, data: result.comment });
  }

  /* POST /api/sessions/:sessionId/issues/:issueId/ack — 清除 issue hasNewInfo */
  const issueAckMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues\/([^/]+)\/ack$/);
  if (method === "POST" && issueAckMatch) {
    const [, sessionId, issueId] = issueAckMatch;
    const sessionDir = join(world.flowsDir, sessionId!);
    const { setIssueNewInfo } = await import("../../collaborable/kanban/methods.js");
    await setIssueNewInfo(sessionDir, issueId!, false);
    return json({ success: true });
  }

  /* POST /api/sessions/:sessionId/tasks/:taskItemId/ack — 清除 task hasNewInfo */
  const taskAckMatch = path.match(/^\/api\/sessions\/([^/]+)\/tasks\/([^/]+)\/ack$/);
  if (method === "POST" && taskAckMatch) {
    const [, sessionId, taskItemId] = taskAckMatch;
    const sessionDir = join(world.flowsDir, sessionId!);
    const { setTaskNewInfo } = await import("../../collaborable/kanban/methods.js");
    await setTaskNewInfo(sessionDir, taskItemId!, false);
    return json({ success: true });
  }

  /* POST /api/sessions/:sessionId/issues/:issueId/status — 切换 Issue 状态
   * body: { status: IssueStatus }
   * 合法 status: discussing / designing / reviewing / executing / confirming / done / closed
   */
  const issueStatusMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues\/([^/]+)\/status$/);
  if (method === "POST" && issueStatusMatch) {
    const [, sessionId, issueId] = issueStatusMatch;
    const body = (await req.json()) as { status?: string };
    const status = body.status;
    const validIssueStatus = new Set([
      "discussing", "designing", "reviewing",
      "executing", "confirming", "done", "closed",
    ]);
    if (!status || !validIssueStatus.has(status)) {
      return errorResponse(
        `非法 status："${status ?? ""}"；合法值为 ${[...validIssueStatus].join(",")}`,
      );
    }
    const sessionDir = join(world.flowsDir, sessionId!);
    if (!existsSync(sessionDir)) return errorResponse(`Session "${sessionId}" 不存在`, 404);
    const { updateIssueStatus } = await import("../../collaborable/kanban/methods.js");
    const { readIssueDetail } = await import("../../collaborable/kanban/store.js");
    try {
      await updateIssueStatus(sessionDir, issueId!, status as import("../../collaborable/kanban/types.js").IssueStatus);
    } catch (e) {
      return errorResponse((e as Error).message, 404);
    }
    const issue = await readIssueDetail(sessionDir, issueId!);
    return json({ success: true, data: issue });
  }

  /* POST /api/sessions/:sessionId/tasks/:taskId/status — 切换 Task 状态
   * body: { status: TaskStatus }
   * 合法 status: running / done / closed
   */
  const taskStatusMatch = path.match(/^\/api\/sessions\/([^/]+)\/tasks\/([^/]+)\/status$/);
  if (method === "POST" && taskStatusMatch) {
    const [, sessionId, taskId] = taskStatusMatch;
    const body = (await req.json()) as { status?: string };
    const status = body.status;
    const validTaskStatus = new Set(["running", "done", "closed"]);
    if (!status || !validTaskStatus.has(status)) {
      return errorResponse(
        `非法 status："${status ?? ""}"；合法值为 ${[...validTaskStatus].join(",")}`,
      );
    }
    const sessionDir = join(world.flowsDir, sessionId!);
    if (!existsSync(sessionDir)) return errorResponse(`Session "${sessionId}" 不存在`, 404);
    const { updateTaskStatus } = await import("../../collaborable/kanban/methods.js");
    const { readTaskDetail } = await import("../../collaborable/kanban/store.js");
    try {
      await updateTaskStatus(sessionDir, taskId!, status as import("../../collaborable/kanban/types.js").TaskStatus);
    } catch (e) {
      return errorResponse((e as Error).message, 404);
    }
    const task = await readTaskDetail(sessionDir, taskId!);
    return json({ success: true, data: task });
  }

  /* POST /api/debug/enable — 开启 debug 模式
   *
   * Debug 模式：OOC 会把每轮 LLM 的输入/输出/思考/元数据写入 thread 的 debug 目录。
   * 不影响执行节奏，不会暂停线程。用于事后排查执行过程。
   */
  if (method === "POST" && path === "/api/debug/enable") {
    world.enableDebug();
    return json({ success: true, data: { debugEnabled: true } });
  }

  /* POST /api/debug/disable — 关闭 debug 模式
   *
   * 关闭 debug 文件写入。
   */
  if (method === "POST" && path === "/api/debug/disable") {
    world.disableDebug();
    return json({ success: true, data: { debugEnabled: false } });
  }

  /* GET /api/debug/status — 查询 debug 模式状态
   *
   * 返回当前是否写入 debug 文件。
   */
  if (method === "GET" && path === "/api/debug/status") {
    return json({ success: true, data: { debugEnabled: world.isDebugEnabled() } });
  }

  /* POST /api/global-pause/enable — 开启全局暂停
   *
   * 全局暂停（global-pause）：暂停所有 running 线程在当前 LLM 轮次结束后进入 paused 状态。
   * 需要 `POST /api/objects/:name/resume` 或 `/api/<...>/resume` 手动唤醒。
   * 与 debug 模式无关——debug 模式不会暂停，全局暂停也不会写 debug 文件。
   */
  if (method === "POST" && path === "/api/global-pause/enable") {
    world.enableGlobalPause();
    return json({ success: true, data: { globalPaused: true } });
  }

  /* POST /api/global-pause/disable — 关闭全局暂停
   *
   * 解除全局暂停状态，不自动唤醒已暂停的线程。
   */
  if (method === "POST" && path === "/api/global-pause/disable") {
    world.disableGlobalPause();
    return json({ success: true, data: { globalPaused: false } });
  }

  /* GET /api/global-pause/status — 查询全局暂停状态
   *
   * 返回当前是否启用了全局暂停。
   */
  if (method === "GET" && path === "/api/global-pause/status") {
    return json({ success: true, data: { globalPaused: world.isGlobalPaused() } });
  }

  /* GET /api/flows/:sessionId/objects/:objectName/context-visibility?focus=:threadId
   *
   * 返回整棵线程树中每个节点相对于 focus 线程 Context 的可见性分类。
   * 分类值见 `kernel/src/observable/visibility/visibility.ts#ContextVisibility`。
   *
   * 参数：
   * - sessionId / objectName：定位 Object 的 Flow 目录
   * - focus（query）：观察主体线程 ID；未提供时默认选 running 叶节点，若无则使用 rootId
   *
   * 返回 { success: true, data: { focusId, visibility: { [threadId]: "..." } } }
   */
  const ctxVisMatch = path.match(/^\/api\/flows\/([^/]+)\/objects\/([^/]+)\/context-visibility$/);
  if (method === "GET" && ctxVisMatch) {
    const sessionId = ctxVisMatch[1]!;
    const objectName = ctxVisMatch[2]!;
    const url = new URL(req.url);
    const focusQuery = url.searchParams.get("focus") ?? undefined;

    const { readThreadsTree } = await import("../../storable/thread/persistence.js");
    const { classifyContextVisibility, pickDefaultFocus } = await import("../visibility/visibility.js");

    const objectFlowDir = join(world.flowsDir, sessionId, "objects", objectName);
    const tree = readThreadsTree(objectFlowDir);
    if (!tree) return errorResponse(`Thread tree 不存在: ${sessionId}/${objectName}`, 404);

    let focusId = focusQuery ?? pickDefaultFocus(tree);
    if (!tree.nodes[focusId]) focusId = tree.rootId;

    const visibility = classifyContextVisibility(tree, focusId);
    return json({ success: true, data: { focusId, visibility } });
  }

  /* GET /api/sessions/:sessionId/user-inbox
   *
   * 返回 session 的 user inbox（引用式收件箱）。
   * user 不参与 ThinkLoop，但系统会记录每次"某对象→user"的 talk，
   * 方便前端聚合渲染 MessageSidebar 的"按对象分组 + 未读角标"。
   *
   * 返回 { success: true, data: { inbox: [{ threadId, messageId }, ...] } }
   * 若 session 不存在或尚未有任何 talk(user)，返回 { inbox: [] }。
   * 消息正文请按 (threadId, messageId) 反查：flows/{sid}/objects/{sender}/threads/{threadId}/thread.json 的 actions[]
   *
   * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox.md
   */
  const userInboxMatch = path.match(/^\/api\/sessions\/([^/]+)\/user-inbox$/);
  if (method === "GET" && userInboxMatch) {
    const sessionId = userInboxMatch[1]!;
    const data = await readUserInbox(world.flowsDir, sessionId);
    return json({ success: true, data });
  }

  /* POST /api/sessions/:sessionId/user-read-state
   *
   * 前端切换到某对象的线程后上报：objectName 读到 timestamp 为止。
   * 后端在 `flows/{sid}/user/data.json` 的 readState.lastReadTimestampByObject 里
   * 单调递增地更新该对象的 lastReadAt（旧 ts 比新 ts 大时忽略，防止乱序回退）。
   *
   * Body: { objectName: string; timestamp: number }
   *
   * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox_read_state.md
   */
  const userReadStateMatch = path.match(/^\/api\/sessions\/([^/]+)\/user-read-state$/);
  if (method === "POST" && userReadStateMatch) {
    const sessionId = userReadStateMatch[1]!;
    let payload: { objectName?: unknown; timestamp?: unknown };
    try {
      payload = (await req.json()) as typeof payload;
    } catch {
      return errorResponse("请求体必须是合法 JSON", 400);
    }
    const objectName = typeof payload.objectName === "string" ? payload.objectName : "";
    const timestamp = typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
      ? payload.timestamp : Number.NaN;
    if (!objectName) return errorResponse("objectName 必填且为字符串", 400);
    if (!Number.isFinite(timestamp)) return errorResponse("timestamp 必填且为数字", 400);

    await setUserReadObject(world.flowsDir, sessionId, objectName, timestamp);
    const data = await readUserInbox(world.flowsDir, sessionId);
    return json({ success: true, data: { readState: data.readState } });
  }

  /* ========== Edit Plans（多文件原子编辑事务） ==========
   *
   * 前端在渲染 LLM 发出的 plan_edits tool_use 时，通过这三个端点完成
   * "查看 diff → 应用 / 取消" 闭环；绕过 LLM 直接操作 persistence 层。
   *
   * - GET    /api/flows/:sid/edit-plans/:planId          返回 plan + preview
   * - POST   /api/flows/:sid/edit-plans/:planId/apply    应用 plan；可选 body.threadId
   *          透传给 applyEditPlan 以让 build hook feedback 落到对应线程 bucket
   * - POST   /api/flows/:sid/edit-plans/:planId/cancel   取消 pending plan
   *
   * @ref docs/工程管理/迭代/all/20260422_feature_edit_plans_http_ui.md
   */

  /* GET /api/flows/:sid/edit-plans/:planId — 读取 plan 详情 + preview */
  const editPlanGetMatch = path.match(/^\/api\/flows\/([^/]+)\/edit-plans\/([^/]+)$/);
  if (method === "GET" && editPlanGetMatch) {
    const sid = editPlanGetMatch[1]!;
    const planId = editPlanGetMatch[2]!;
    const plan = await readEditPlan(planId, { sessionId: sid, flowsRoot: world.flowsDir });
    if (!plan) return errorResponse(`plan "${planId}" 不存在`, 404);
    const preview = await previewEditPlan(plan);
    return json({ success: true, data: { plan, preview } });
  }

  /* POST /api/flows/:sid/edit-plans/:planId/apply — 应用 plan
   *
   * 409 仅在 readEditPlan 读到的 plan.status !== pending 时返回（避免对 applied/failed/
   * cancelled 重复 apply）；实际 applyEditPlan 内部也有同样的校验作为二重保险。
   * 可选 body.threadId 透传给 runBuildHooks，feedback 隔离到该线程。 */
  const editPlanApplyMatch = path.match(/^\/api\/flows\/([^/]+)\/edit-plans\/([^/]+)\/apply$/);
  if (method === "POST" && editPlanApplyMatch) {
    const sid = editPlanApplyMatch[1]!;
    const planId = editPlanApplyMatch[2]!;
    const plan = await readEditPlan(planId, { sessionId: sid, flowsRoot: world.flowsDir });
    if (!plan) return errorResponse(`plan "${planId}" 不存在`, 404);
    if (plan.status !== "pending") {
      return errorResponse(`plan 已是 ${plan.status} 状态，不能重复应用`, 409);
    }

    /* 宽容解析 body：无 body 或非 JSON 都视作未传 threadId */
    let threadId: string | undefined;
    try {
      const raw = (await req.json()) as Record<string, unknown>;
      if (typeof raw?.threadId === "string") threadId = raw.threadId;
    } catch {
      /* 无 body 或 body 非合法 JSON → threadId 留空 */
    }

    const result = await applyEditPlan(plan, {
      sessionId: sid,
      flowsRoot: world.flowsDir,
      threadId,
    });
    /* 读取最新 plan 状态（applyEditPlan 已重新落盘）供前端展示 */
    const updatedPlan = await readEditPlan(planId, { sessionId: sid, flowsRoot: world.flowsDir });
    return json({ success: true, data: { result, plan: updatedPlan ?? plan } });
  }

  /* POST /api/flows/:sid/edit-plans/:planId/cancel — 取消 pending plan */
  const editPlanCancelMatch = path.match(/^\/api\/flows\/([^/]+)\/edit-plans\/([^/]+)\/cancel$/);
  if (method === "POST" && editPlanCancelMatch) {
    const sid = editPlanCancelMatch[1]!;
    const planId = editPlanCancelMatch[2]!;
    const plan = await readEditPlan(planId, { sessionId: sid, flowsRoot: world.flowsDir });
    if (!plan) return errorResponse(`plan "${planId}" 不存在`, 404);
    const updated = await cancelEditPlan(plan, { sessionId: sid, flowsRoot: world.flowsDir });
    return json({ success: true, data: { plan: updated } });
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
  readme: string;
  hasMethods: boolean;
  methods: { name: string; description: string }[];
}

/**
 * 获取对象的 traits 详情（对象自身 + kernel）
 *
 * 本函数仅扫 traits/ 一级子目录（不递归），用于前端对象详情页的 trait 列表展示。
 */
async function getTraitsInfo(
  objectDir: string,
  worldRootDir: string,
): Promise<{ traits: TraitInfo[]; kernelTraits: TraitInfo[] }> {
  const objectTraitsDir = join(objectDir, "traits");
  const kernelTraitsDir = join(worldRootDir, "kernel", "traits");

  const loadTraitInfos = async (
    dir: string,
    expectedNamespace: "self" | "kernel",
  ): Promise<TraitInfo[]> => {
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const infos: TraitInfo[] = [];
    for (const name of names) {
      const trait = await loadTrait(join(dir, name), expectedNamespace);
      if (trait) {
        const methods = [
          ...Object.entries(trait.llmMethods ?? {}).map(([methodName, method]) => ({
            name: methodName,
            description: method.description,
          })),
          ...Object.entries(trait.uiMethods ?? {}).map(([methodName, method]) => ({
            name: methodName,
            description: method.description,
          })),
        ];
        infos.push({
          name: `${trait.namespace}:${trait.name}`,
          readme: trait.readme,
          hasMethods: methods.length > 0,
          methods,
        });
      }
    }
    return infos;
  };

  return {
    traits: await loadTraitInfos(objectTraitsDir, "self"),
    kernelTraits: await loadTraitInfos(kernelTraitsDir, "kernel"),
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
  failureReason?: string;
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
    failureReason?: string;
  }> = [];

  for (const sessionId of sessionIds) {
    /* 新结构：session/objects/user/ */
    let flow = readFlow(join(flowsDir, sessionId, "objects", "user"));
    if (!flow) {
      /* 线程树兼容：扫描 objects/ 下第一个有 data.json 的子目录 */
      const objectsDir = join(flowsDir, sessionId, "objects");
      if (existsSync(objectsDir)) {
        const entries = readdirSync(objectsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const subFlow = readFlow(join(objectsDir, entry.name));
          if (subFlow) { flow = subFlow; break; }
        }
      }
    }
    if (!flow) {
      /* 兼容旧数据：session 根目录 */
      flow = readFlow(join(flowsDir, sessionId));
    }
    if (!flow) {
      // 线程树 session 可能只有 threads.json / thread.json 而没有兼容的 Flow data.json。
      // 但只要存在 .session.json（或被 listFlowSessions 识别为旧结构 session），仍应出现在 sessions 列表。
      const sessionDir = join(flowsDir, sessionId);
      const sessionFile = join(sessionDir, ".session.json");
      let title = "";
      let createdAt = Date.now();
      let updatedAt = Date.now();
      try {
        const dirStat = statSync(sessionDir);
        createdAt = dirStat.birthtimeMs ? Math.floor(dirStat.birthtimeMs) : Date.now();
        updatedAt = dirStat.mtimeMs ? Math.floor(dirStat.mtimeMs) : Date.now();
      } catch { /* ignore */ }
      if (existsSync(sessionFile)) {
        try {
          const meta = JSON.parse(readFileSync(sessionFile, "utf-8"));
          if (typeof meta.title === "string") title = meta.title;
        } catch { /* ignore */ }
        try {
          const fileStat = statSync(sessionFile);
          const fileUpdatedAt = fileStat.mtimeMs ? Math.floor(fileStat.mtimeMs) : undefined;
          if (fileUpdatedAt && fileUpdatedAt > updatedAt) updatedAt = fileUpdatedAt;
        } catch { /* ignore */ }
      }

      summaries.push({
        sessionId,
        title,
        status: "running",
        firstMessage: "",
        messageCount: 0,
        actionCount: 0,
        hasProcess: false,
        createdAt,
        updatedAt,
      });
      continue;
    }

    /* 读取 .session.json 中的 title（优先于 flow.title） */
    let sessionTitle = flow.title;
    const sessionFile = join(flowsDir, sessionId, ".session.json");
    if (existsSync(sessionFile)) {
      try {
        const meta = JSON.parse(readFileSync(sessionFile, "utf-8"));
        if (typeof meta.title === "string") sessionTitle = meta.title;
      } catch { /* 忽略解析错误 */ }
    }

    const firstIn = flow.messages.find((m) => m.direction === "in" && !m.content.startsWith("[系统通知]"))
      ?? flow.messages.find((m) => m.direction === "in");
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
      failureReason: flow.failureReason,
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

  /* ooc://view/{相对路径} — 对象的 view 资源（stones/{name}/views/... 或 flows/{sid}/objects/{name}/views/...） */
  const viewMatch = oocUrl.match(/^ooc:\/\/view\/(.+)$/);
  if (viewMatch) {
    const relPath = decodeURIComponent(viewMatch[1]!);
    /* 尾部斜杠时默认指向 frontend.tsx；否则原样解析 */
    const resolvedRel = relPath.endsWith("/") ? relPath + "frontend.tsx" : relPath;
    const filePath = join(world.rootDir, resolvedRel);
    /* 安全检查 */
    if (!filePath.startsWith(world.rootDir)) return errorResponse("非法路径", 403);
    if (!existsSync(filePath)) return errorResponse(`View 文件 "${resolvedRel}" 不存在`, 404);
    const content = readFileSync(filePath, "utf-8");
    return json({ success: true, data: { type: "view", path: resolvedRel, content } });
  }

  return errorResponse(`无法解析 ooc:// URL: ${oocUrl}`);
}
