/**
 * Worker: 驱动 ThinkThread 的轮询 worker。
 *
 * Worker 持有一个 job queue（Map<threadId, ThinkThread>），
 * 通过 setInterval 轮询：每个 tick 取 status=running 的第一个 thread，
 * 调用 think()，直到 queue 中所有 thread 都终止为止。
 *
 * 设计约束：
 * - Worker 不负责加载 Object registry（由 HTTP 层或测试代码在 submit 前构造 thread）
 * - Worker 不直接持久化 thread（P7 扩展时加）
 * - worldRoot 暴露为只读 getter，供 HTTP 层读取
 */

import type { LlmClient } from "./llm/types";
import type { ThinkThread } from "./think-thread";
import { think } from "./thinkloop";

export interface WorkerConfig {
    worldRoot: string;
    pollMs: number;
    maxConcurrent?: number;  // 同时最多运行多少个 thread（P6 默认 1）
}

export class Worker {
    readonly config: WorkerConfig;
    private readonly llmClient: LlmClient;
    private readonly queue = new Map<string, ThinkThread>();
    private timer: ReturnType<typeof setInterval> | undefined;
    private running = false;
    private activeTick = false;  // 防止 tick 重入

    constructor(config: WorkerConfig, llmClient: LlmClient) {
        this.config = config;
        this.llmClient = llmClient;
    }

    /** worldRoot 访问器——供 HTTP 层读取，无需 as any. */
    get worldRoot(): string {
        return this.config.worldRoot;
    }

    /**
     * 提交一个 thread 到队列。
     * 若 thread.id 已存在则覆盖（幂等行为：重新提交视为重启）。
     */
    submit(thread: ThinkThread): void {
        this.queue.set(thread.id, thread);
    }

    /**
     * 按 id 查询当前 queue 中的 thread。
     */
    get(threadId: string): ThinkThread | undefined {
        return this.queue.get(threadId);
    }

    /**
     * 返回 queue 中所有 thread（快照）。
     */
    list(): ThinkThread[] {
        return Array.from(this.queue.values());
    }

    /**
     * 启动轮询。已启动时为 no-op。
     */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.timer = setInterval(() => {
            void this.tick();
        }, this.config.pollMs);
    }

    /**
     * 停止轮询并清空计时器。
     */
    stop(): void {
        this.running = false;
        if (this.timer !== undefined) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /**
     * 手动触发一次调度 tick（测试友好：不需要真实 setInterval）。
     */
    async tick(): Promise<void> {
        if (this.activeTick) return;  // 防止重入
        this.activeTick = true;
        try {
            const running = Array.from(this.queue.values()).filter(
                (t) => t.status === "running",
            );
            if (running.length === 0) return;

            const maxConcurrent = this.config.maxConcurrent ?? 1;
            const batch = running.slice(0, maxConcurrent);

            await Promise.all(batch.map((thread) => think(thread, this.llmClient)));
        } finally {
            this.activeTick = false;
        }
    }

    /**
     * 运行直到 queue 中所有 thread 都不再 running（用于测试 / 离线批处理）。
     * 内部按 pollMs 轮询，maxWaitMs 超时后中止并抛错。
     */
    async runUntilDone(maxWaitMs = 30_000): Promise<void> {
        const deadline = Date.now() + maxWaitMs;
        while (Date.now() < deadline) {
            const hasRunning = Array.from(this.queue.values()).some(
                (t) => t.status === "running",
            );
            if (!hasRunning) return;
            await this.tick();
            // 短暂 yield，让其他 Promise 有机会执行
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        throw new Error(`Worker.runUntilDone: timed out after ${maxWaitMs}ms`);
    }
}
