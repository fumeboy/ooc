/**
 * World 集成测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { World } from "../src/world/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_world_test");

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("World", () => {
  test("初始化创建目录结构", () => {
    const world = new World({ rootDir: TEST_DIR });
    world.init();

    const { existsSync } = require("node:fs");
    expect(existsSync(join(TEST_DIR, "readme.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "data.json"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "stones"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "flows"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "kernel", "traits", "computable", "readme.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "kernel", "traits", "talkable", "readme.md"))).toBe(true);
    /* user 对象自动创建（G1: 人类也是对象） */
    expect(existsSync(join(TEST_DIR, "stones", "user", "readme.md"))).toBe(true);
  });

  test("创建对象", () => {
    const world = new World({ rootDir: TEST_DIR });
    world.init();

    const stone = world.createObject("greeter", "你是一个友好的问候者");
    expect(stone.name).toBe("greeter");
    expect(stone.thinkable.whoAmI).toBe("你是一个友好的问候者");
  });

  test("列出对象", () => {
    const world = new World({ rootDir: TEST_DIR });
    world.init();

    world.createObject("alpha", "Alpha");
    world.createObject("beta", "Beta");

    const objects = world.listObjects();
    /* user + alpha + beta = 3 */
    expect(objects).toHaveLength(3);
    expect(objects.map((o) => o.name).sort()).toEqual(["alpha", "beta", "user"]);
  });

  test("获取对象", () => {
    const world = new World({ rootDir: TEST_DIR });
    world.init();

    world.createObject("test", "Test");
    const found = world.getObject("test");
    expect(found).not.toBeUndefined();
    expect(found!.name).toBe("test");

    const notFound = world.getObject("nonexistent");
    expect(notFound).toBeUndefined();
  });

  test("重复创建对象抛出错误", () => {
    const world = new World({ rootDir: TEST_DIR });
    world.init();

    world.createObject("unique", "Unique");
    expect(() => world.createObject("unique", "Duplicate")).toThrow();
  });

  test("重启后加载已有对象", () => {
    /* 第一次启动，创建对象 */
    const world1 = new World({ rootDir: TEST_DIR });
    world1.init();
    world1.createObject("persistent", "我会被记住");

    /* 第二次启动 */
    const world2 = new World({ rootDir: TEST_DIR });
    world2.init();

    const objects = world2.listObjects();
    /* user + persistent = 2 */
    expect(objects).toHaveLength(2);
    expect(objects.map((o) => o.name).sort()).toEqual(["persistent", "user"]);
  });
});
