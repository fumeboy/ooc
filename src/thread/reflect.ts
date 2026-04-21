/**
 * Reflect 常驻反思线程管理（方案 A 最小可用）
 *
 * 每个对象拥有一条常驻的「反思线程」，独立于任何 session：
 * - 落盘在 `stones/{name}/reflect/threads.json + threads/{id}/thread.json`
 * - 使用与普通 session 相同的线程树数据结构（复用 `ThreadsTree`）
 * - 消息通过 `talkToReflect(stoneDir, from, message)` 写入 root 线程的 inbox
 *
 * **当前限制（方案 A）**：本模块只负责管道——消息落盘到 inbox，
 * 反思线程暂不触发 ThinkLoop 执行（跨 session 常驻 scheduler 是后续迭代的工作）。
 * 这意味着消息投递后会"静静躺在 inbox 里"，直到将来接入反思调度器。
 *
 * @ref docs/哲学文档/gene.md#G12 — implements — 经验沉淀循环（工程侧通道）
 * @ref docs/工程管理/迭代/all/20260421_feature_ReflectFlow线程树化.md — references — 迭代文档
 * @ref kernel/src/thread/tree.ts — references — ThreadsTree（复用）
 */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { consola } from "consola";

import { ThreadsTree } from "./tree.js";

/**
 * 对一个 stone 目录内的「反思目录」并发访问做串行化
 *
 * 由于 reflect 线程是跨 session 共享的——同一时刻多个 session 里多个对象可能
 * 同时 talkToSelf，两者最终都落到同一个 `stones/{name}/reflect/threads.json`。
 * `ThreadsTree.load / create` 本身会读写同一个文件，如果两个并发请求里一个在
 * `load()` 发现文件不存在决定 create，另一个也走到 create，就会互相覆盖。
 *
 * 这里用一个进程内 promise 串行化每个 stoneDir 的 ensureReflectThread/talkToReflect，
 * 保证"同一个 reflect 目录的首次初始化 + 后续 writeInbox"顺序进行。
 */
const REFLECT_LOCKS = new Map<string, Promise<void>>();

/** 按 stoneDir 串行化一段异步操作 */
async function withReflectLock<T>(stoneDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = REFLECT_LOCKS.get(stoneDir) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  /* 把新的 chain promise 存回 map，作为下一个等待者的 prev */
  const chained = prev.then(() => next);
  REFLECT_LOCKS.set(stoneDir, chained);

  try {
    await prev;
    return await fn();
  } finally {
    release();
    /* 若没有新任务排进来（map 中仍是我们刚写入的 chain），清理 lock（轻量 GC） */
    if (REFLECT_LOCKS.get(stoneDir) === chained) {
      REFLECT_LOCKS.delete(stoneDir);
    }
  }
}

/**
 * 返回某对象的反思目录路径（约定 `{stoneDir}/reflect`）
 *
 * 该路径对应一棵独立的 ThreadsTree：`reflect/threads.json + reflect/threads/{id}/thread.json`。
 *
 * @param stoneDir - 对象自身目录（如 `stones/bruce`）
 * @returns 反思目录绝对路径
 */
export function getReflectThreadDir(stoneDir: string): string {
  return join(stoneDir, "reflect");
}

/**
 * 确保对象的反思线程存在（幂等）
 *
 * 首次调用时创建常驻 root 线程（status=running），后续调用直接加载内存模型返回。
 *
 * @param stoneDir - 对象自身目录
 * @returns 反思线程的 ThreadsTree 实例（内存模型）
 */
export async function ensureReflectThread(stoneDir: string): Promise<ThreadsTree> {
  return withReflectLock(stoneDir, async () => {
    const reflectDir = getReflectThreadDir(stoneDir);
    mkdirSync(reflectDir, { recursive: true });

    const existing = ThreadsTree.load(reflectDir);
    if (existing) return existing;

    /* 首次创建：root 线程标题固定为 "reflect" */
    const tree = await ThreadsTree.create(
      reflectDir,
      "reflect",
      "对象常驻反思线程：接收 talkToSelf 投递的经验条目，用于沉淀到长期记忆。",
    );
    consola.info(`[Reflect] 创建反思线程: ${reflectDir} rootId=${tree.rootId}`);
    return tree;
  });
}

/**
 * 向对象的反思线程投递一条消息
 *
 * 行为：
 * 1. 确保反思线程已初始化（等价 `ensureReflectThread`）
 * 2. 向 root 线程 inbox 写入消息（`source: "system"`, status=unread）
 * 3. 若 root 线程当前为 done，会通过 `tree.writeInbox` 内置的复活逻辑
 *    自动变回 running（后续接入反思调度器后即可被消费）
 *
 * 方案 A 限制：投递后不触发 ThinkLoop 执行，消息仅落盘等待未来消费。
 *
 * @param stoneDir - 对象自身目录
 * @param from - 发起方（通常是当前 Object 名称或调用方线程的 Object 名）
 * @param message - 要反思的消息正文
 * @param messageId - 可选，调用方追踪 ID（当前 tree.writeInbox 自行生成 inbox id，此字段仅保留给未来前端索引使用）
 */
export async function talkToReflect(
  stoneDir: string,
  from: string,
  message: string,
  messageId?: string,
): Promise<void> {
  await withReflectLock(stoneDir, async () => {
    const reflectDir = getReflectThreadDir(stoneDir);
    mkdirSync(reflectDir, { recursive: true });

    /* 确保线程树存在（内联实现以复用锁） */
    let tree = ThreadsTree.load(reflectDir);
    if (!tree) {
      tree = await ThreadsTree.create(
        reflectDir,
        "reflect",
        "对象常驻反思线程：接收 talkToSelf 投递的经验条目，用于沉淀到长期记忆。",
      );
      consola.info(`[Reflect] 创建反思线程: ${reflectDir} rootId=${tree.rootId}`);
    }

    /* 写入 inbox（writeInbox 内置 done→running 复活 + 溢出处理） */
    tree.writeInbox(tree.rootId, {
      from,
      content: message,
      source: "system",
    });

    consola.info(
      `[Reflect] talkToReflect: stoneDir=${stoneDir} from=${from} len=${message.length}${messageId ? ` messageId=${messageId}` : ""}`,
    );
  });
}
