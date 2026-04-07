/**
 * CLI 入口
 *
 * 用法：
 *   bun src/cli.ts start [port]       — 启动服务器
 *   bun src/cli.ts talk <object> <msg> — 向对象发消息
 *   bun src/cli.ts create <name>       — 创建对象
 *   bun src/cli.ts list                — 列出所有对象
 *
 * @ref src/world/world.ts — references — World 根对象初始化
 * @ref src/server/server.ts — references — startServer HTTP 服务
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { consola } from "consola";
import { World } from "./world/index.js";
import { startServer } from "./server/server.js";

/** user repo 根目录（即 cwd） */
const OOC_ROOT = process.cwd();

/** 主入口 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  /* 验证 kernel submodule 存在 */
  if (!existsSync(join(OOC_ROOT, "kernel"))) {
    consola.error("kernel/ 目录不存在。请确保从 user repo 根目录运行，且已初始化 submodule: git submodule update --init");
    process.exit(1);
  }

  /* 初始化 World — 线程树架构默认启用，OOC_THREAD_TREE=0 可回退 */
  const useThreadTree = process.env.OOC_THREAD_TREE !== "0";
  const world = new World({ rootDir: OOC_ROOT, useThreadTree });
  if (!useThreadTree) consola.info("[CLI] 使用旧 Flow 架构 (OOC_THREAD_TREE=0)");
  world.init();

  switch (command) {
    case "start": {
      const port = parseInt(args[1] ?? "8080", 10);
      startServer({ port, world });
      break;
    }

    case "talk": {
      const objectName = args[1];
      const message = args.slice(2).join(" ");

      if (!objectName || !message) {
        consola.error("用法: bun src/cli.ts talk <object> <message>");
        process.exit(1);
      }

      consola.info(`向 ${objectName} 发送: "${message}"`);

      let flow;
      try {
        flow = await world.talk(objectName, message);
      } catch (e) {
        consola.error((e as Error).message);
        process.exit(1);
      }

      consola.info(`\n=== 任务 ${flow.sessionId} 完成 ===`);
      consola.info(`状态: ${flow.status}`);

      /* 输出最终消息 */
      const outMessages = flow.messages.filter((m) => m.direction === "out");
      if (outMessages.length > 0) {
        consola.info("\n--- 回复 ---");
        for (const msg of outMessages) {
          console.log(msg.content);
        }
      }
      break;
    }

    case "create": {
      const name = args[1];
      const whoAmI = args.slice(2).join(" ") || "";

      if (!name) {
        consola.error("用法: bun src/cli.ts create <name> [whoAmI]");
        process.exit(1);
      }

      const stone = world.createObject(name, whoAmI);
      consola.info(`对象 "${stone.name}" 创建成功`);
      consola.info(`目录: stones/${stone.name}/`);
      break;
    }

    case "list": {
      const objects = world.listObjects();
      if (objects.length === 0) {
        consola.info("暂无对象");
      } else {
        consola.info(`共 ${objects.length} 个对象:\n`);
        for (const obj of objects) {
          const intro = obj.talkable.whoAmI || "(无简介)";
          consola.info(`  ${obj.name} — ${intro}`);
        }
      }
      break;
    }

    default:
      consola.error(`未知命令: ${command}`);
      printUsage();
      process.exit(1);
  }
}

/** 打印用法 */
function printUsage(): void {
  console.log(`
OOC — Object-Oriented Context

用法:
  bun src/cli.ts start [port]        启动服务器（默认 8080）
  bun src/cli.ts talk <object> <msg> 向对象发消息
  bun src/cli.ts create <name>       创建对象
  bun src/cli.ts list                列出所有对象
`);
}

main().catch((e) => {
  consola.error("致命错误:", e);
  process.exit(1);
});
