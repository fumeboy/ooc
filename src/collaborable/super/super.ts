/**
 * SuperFlow 落盘 — talk(target="super") 的 onTalk 路由 helper
 *
 * 设计哲学：
 * - A 对 super 说话 = A 对自己说话（super ≈ super-ego，对象的反思镜像分身）
 * - super 不是 Registry 里的对象，而是任何 stone 的内部子目录
 * - 通过 `stones/{fromObject}/super/` 下的独立 ThreadsTree 落盘消息
 * - super 线程跨 session 常驻（反思是长期的，不跟随一次对话结束）
 *
 * 工程约束（本迭代阶段）：
 * - handleOnTalkToSuper 只做 inbox 落盘，**不触发 ThinkLoop**
 * - super 线程的实际消费（跑 ThinkLoop + persist_to_memory）依赖
 *   跨 session 常驻调度器——本阶段暂不接入
 * - 因此返回 `reply: null`，表示"已投递、不等回复"
 *
 * 替代关系：
 * - 替代方案 B 的 `reflect.ts::talkToReflect` + `collaboration.ts::talkToSelf`
 * - 路径：LLM → callMethod("reflective/reflect_flow", "talkToSelf", ...)
 *         变为：LLM → talk("super", ...)
 *
 * @ref docs/工程管理/迭代/all/20260422_refactor_SuperFlow转型.md
 * @ref docs/哲学文档/gene.md#G12 — implements — 经验沉淀循环（工程通道）
 */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { consola } from "consola";

import { ThreadsTree } from "../../thinkable/thread-tree/tree.js";
import { SerialQueue } from "../../shared/utils/serial-queue.js";

/**
 * super 目录级串行化队列（key = stone 的 super 目录绝对路径）
 *
 * 同一时刻多个 session 里多个线程可能同时 talk("super", ...)。若都走到同一
 * `stones/{name}/super/` 的 ThreadsTree.load/create，会互相覆盖 threads.json。
 * 这里按 super 目录加串行锁，不同对象互不阻塞。
 */
const _superQueue = new SerialQueue<string>();

/**
 * 返回某对象的 super 目录路径（约定 `{rootDir}/stones/{fromObject}/super`）
 */
export function getSuperThreadDir(rootDir: string, fromObject: string): string {
  return join(rootDir, "stones", fromObject, "super");
}

/**
 * handleOnTalkToSuper —— 处理 onTalk 的 target="super" 分支
 *
 * 落盘行为：
 * 1. 确保 `stones/{fromObject}/super/` 存在（首次自动 mkdir + 创建 root 线程）
 * 2. 向 root 线程的 inbox 写入消息（source="system"，from=fromObject）
 * 3. 若 root 线程当前为 done，tree.writeInbox 内置复活逻辑会自动转为 running
 * 4. 返回 `{ reply: null, remoteThreadId: rootId }`——表示已落盘、不等回复
 *
 * 为什么 reply=null：
 * - super 没有立即执行 ThinkLoop（调度器后续迭代接入）
 * - 返回 null 让调用方线程感知"这是异步通道、不是同步问答"
 * - 与 handleOnTalkToUser 的设计保持一致（user 也不回复）
 *
 * @param params.fromObject 发起方对象名（用于定位 super 目录）
 * @param params.message 要投递的反思消息
 * @param params.rootDir user repo 根目录
 * @param params.messageId engine 生成的 message_out action id（可选）
 */
export async function handleOnTalkToSuper(params: {
  fromObject: string;
  message: string;
  rootDir: string;
  messageId?: string;
}): Promise<{ reply: null; remoteThreadId: string }> {
  const { fromObject, message, rootDir, messageId } = params;

  const superDir = getSuperThreadDir(rootDir, fromObject);

  return _superQueue.enqueue(superDir, async () => {
    /* 确保目录存在（首次会兜底 mkdir stones/{fromObject}/super） */
    mkdirSync(superDir, { recursive: true });

    /* 加载或创建 ThreadsTree */
    let tree = ThreadsTree.load(superDir);
    if (!tree) {
      tree = await ThreadsTree.create(
        superDir,
        `${fromObject}:super`,
        `${fromObject} 的反思镜像分身：接收 talk(super) 投递的经验条目，由沉淀工具（persist_to_memory / create_trait）消费。`,
      );
      consola.info(`[Super] 创建 super 线程树: ${superDir} rootId=${tree.rootId}`);
    }

    /* 写入 inbox（内置 done→running 复活 + 溢出处理） */
    tree.writeInbox(tree.rootId, {
      from: fromObject,
      content: message,
      source: "system",
    });

    consola.info(
      `[Super] ${fromObject} → super 投递: len=${message.length}${messageId ? ` messageId=${messageId}` : ""} rootId=${tree.rootId}`,
    );

    return { reply: null, remoteThreadId: tree.rootId };
  });
}
