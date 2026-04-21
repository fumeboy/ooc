/**
 * SerialQueue 单元测试
 *
 * 覆盖：
 * - 同 key 串行化（顺序执行，前一个不完成后一个不开始）
 * - 不同 key 并行（互不阻塞）
 * - 错误隔离（一个 fn reject，其他 key 不受影响；同 key 后续 fn 继续执行）
 * - 大并发压力（100 fn × 10 keys）
 * - enqueue 返回值正确传递
 *
 * @ref docs/工程管理/迭代/all/20260421_refactor_write_queue统一.md
 */
import { describe, test, expect } from "bun:test";
import { SerialQueue } from "../src/utils/serial-queue.js";

/** 小工具：延时 */
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe("SerialQueue", () => {
  test("同 key 的多个 fn 串行执行", async () => {
    const q = new SerialQueue<string>();
    const order: string[] = [];

    const p1 = q.enqueue("k", async () => {
      await sleep(30);
      order.push("a");
      return "A";
    });
    const p2 = q.enqueue("k", async () => {
      order.push("b");
      return "B";
    });
    const p3 = q.enqueue("k", async () => {
      order.push("c");
      return "C";
    });

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(["A", "B", "C"]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("不同 key 并行（互不阻塞）", async () => {
    const q = new SerialQueue<string>();
    const startTimes: Record<string, number> = {};
    const t0 = Date.now();

    /* 两个不同 key 的 fn，各睡 50ms；总时间应接近 50ms 而非 100ms */
    const p1 = q.enqueue("ka", async () => {
      startTimes.ka = Date.now() - t0;
      await sleep(50);
      return "A";
    });
    const p2 = q.enqueue("kb", async () => {
      startTimes.kb = Date.now() - t0;
      await sleep(50);
      return "B";
    });

    await Promise.all([p1, p2]);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(90); // 充裕的并行预算
    expect(startTimes.ka! < 20).toBe(true);
    expect(startTimes.kb! < 20).toBe(true);
  });

  test("错误隔离：同 key 某 fn reject 不阻塞后续", async () => {
    const q = new SerialQueue<string>();

    const p1 = q.enqueue("k", async () => {
      throw new Error("boom");
    });
    const p2 = q.enqueue("k", async () => "ok");

    await expect(p1).rejects.toThrow("boom");
    await expect(p2).resolves.toBe("ok");
  });

  test("错误隔离：一个 key fn reject 不影响其他 key", async () => {
    const q = new SerialQueue<string>();

    const pa = q.enqueue("ka", async () => { throw new Error("a-boom"); });
    const pb = q.enqueue("kb", async () => "ok-b");

    await expect(pa).rejects.toThrow("a-boom");
    await expect(pb).resolves.toBe("ok-b");
  });

  test("大并发压力：100 fn × 10 keys", async () => {
    const q = new SerialQueue<string>();
    const counters: Record<string, number> = {};
    const promises: Promise<unknown>[] = [];
    for (let k = 0; k < 10; k++) counters[`key_${k}`] = 0;

    for (let i = 0; i < 1000; i++) {
      const key = `key_${i % 10}`;
      promises.push(q.enqueue(key, async () => {
        counters[key] = (counters[key] ?? 0) + 1;
        return counters[key];
      }));
    }
    await Promise.all(promises);
    for (let k = 0; k < 10; k++) {
      expect(counters[`key_${k}`]).toBe(100);
    }
  });

  test("返回值类型保持泛型", async () => {
    const q = new SerialQueue<string>();
    const n: number = await q.enqueue("k", async () => 42);
    const s: string = await q.enqueue("k", async () => "hello");
    expect(n).toBe(42);
    expect(s).toBe("hello");
  });

  test("同 key 串行真的等前一个完成", async () => {
    const q = new SerialQueue<string>();
    let running = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 20 }, (_, i) => q.enqueue("k", async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await sleep(1);
      running--;
      return i;
    }));
    await Promise.all(tasks);
    expect(maxConcurrent).toBe(1);
  });
});
