/**
 * 串行化写入队列测试
 *
 * 验证并发写入操作被正确串行化执行。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#10.2
 */
import { describe, test, expect } from "bun:test";
import { WriteQueue } from "../src/storable/thread/queue.js";

describe("WriteQueue", () => {
  test("顺序执行写入操作", async () => {
    const queue = new WriteQueue();
    const order: number[] = [];

    await queue.enqueue(async () => { order.push(1); });
    await queue.enqueue(async () => { order.push(2); });
    await queue.enqueue(async () => { order.push(3); });

    expect(order).toEqual([1, 2, 3]);
  });

  test("并发提交时保证串行执行", async () => {
    const queue = new WriteQueue();
    const order: number[] = [];

    const p1 = queue.enqueue(async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push(1);
    });
    const p2 = queue.enqueue(async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(2);
    });
    const p3 = queue.enqueue(async () => {
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  test("前一个操作失败不阻塞后续操作", async () => {
    const queue = new WriteQueue();
    const order: number[] = [];

    const p1 = queue.enqueue(async () => {
      throw new Error("写入失败");
    }).catch(() => { order.push(-1); });

    const p2 = queue.enqueue(async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([-1, 2]);
  });
});
