/**
 * Stone 对象测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Stone } from "../src/stone/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_stone_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Stone", () => {
  test("创建新 Stone", () => {
    const dir = join(TEST_DIR, "greeter");
    const stone = Stone.create(dir, "greeter", "你好，我是一个友好的问候者");

    expect(stone.name).toBe("greeter");
    expect(stone.thinkable.whoAmI).toBe("你好，我是一个友好的问候者");
    expect(stone.data).toEqual({});
    expect(stone.relations).toEqual([]);
  });

  test("加载已有 Stone", () => {
    const dir = join(TEST_DIR, "loader");
    Stone.create(dir, "loader", "我是加载测试");

    const loaded = Stone.load(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("loader");
    expect(loaded!.thinkable.whoAmI).toBe("我是加载测试");
  });

  test("加载不存在的目录返回 null", () => {
    const result = Stone.load(join(TEST_DIR, "nonexistent"));
    expect(result).toBeNull();
  });

  test("数据操作是不可变的", () => {
    const dir = join(TEST_DIR, "immutable");
    const stone = Stone.create(dir, "immutable", "");

    stone.setData("key1", "value1");
    const data1 = stone.data;

    stone.setData("key2", "value2");
    const data2 = stone.data;

    /* data1 不受 data2 影响 */
    expect(data1).not.toHaveProperty("key2");
    expect(data2).toHaveProperty("key1");
    expect(data2).toHaveProperty("key2");
  });

  test("保存并重新加载", () => {
    const dir = join(TEST_DIR, "persist");
    const stone = Stone.create(dir, "persist", "持久化测试");

    stone.setData("count", 42);
    stone.addRelation({ name: "helper", description: "帮助者" });
    stone.save();

    const reloaded = Stone.load(dir);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.getData("count")).toBe(42);
    expect(reloaded!.relations).toHaveLength(1);
  });
});
