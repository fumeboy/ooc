import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetSerialQueueForTests, enqueueSessionWrite } from "../serial-queue";

let tempBase: string | undefined;

beforeEach(() => {
  __resetSerialQueueForTests();
});

afterEach(async () => {
  if (tempBase) {
    await rm(tempBase, { recursive: true, force: true });
    tempBase = undefined;
  }
});

describe("enqueueSessionWrite", () => {
  test("serializes same-session tasks (later tasks see earlier writes)", async () => {
    const order: number[] = [];
    const p1 = enqueueSessionWrite("s1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const p2 = enqueueSessionWrite("s1", async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  test("different sessions run in parallel", async () => {
    const order: string[] = [];
    const p1 = enqueueSessionWrite("a", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("a");
    });
    const p2 = enqueueSessionWrite("b", async () => {
      order.push("b"); // should run before a finishes
    });
    await Promise.all([p1, p2]);
    expect(order[0]).toBe("b");
    expect(order[1]).toBe("a");
  });

  test("error in one task does not poison the queue", async () => {
    const p1 = enqueueSessionWrite("s1", async () => {
      throw new Error("boom");
    });
    await expect(p1).rejects.toThrow("boom");

    // Subsequent task on same session still runs
    const result = await enqueueSessionWrite("s1", async () => "ok");
    expect(result).toBe("ok");
  });

  test("100 concurrent enqueues retain order", async () => {
    const seen: number[] = [];
    const promises = Array.from({ length: 100 }, (_, i) =>
      enqueueSessionWrite("s1", async () => {
        seen.push(i);
      }),
    );
    await Promise.all(promises);
    expect(seen).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});
