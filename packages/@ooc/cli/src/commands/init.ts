import { mkdir, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

/**
 * ooc init [path] — scaffold a new OOC World.
 *
 * 生成：
 *   package.json
 *   tsconfig.json
 *   .world.json
 *   .env.example
 *   .gitignore
 *   stones/supervisor/self.md (示例 stone — 之后由用户自行定义)
 *   stones/supervisor/package.json
 *   stones/user/self.md
 *   stones/user/package.json
 *
 * 如果目录已存在且非空 → 报错，避免覆盖用户代码。
 * 可以 --force 强制跳过存在性检查（只在完全空目录下仍会新建子目录）。
 */

const DEFAULT_OOC_VERSION = "^0.1.0";

function readFlagValue(argv: string[], names: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    for (const name of names) {
      if (arg === name) return argv[i + 1];
      const prefix = `${name}=`;
      if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    }
  }
  return undefined;
}

function hasFlag(argv: string[], names: string[]): boolean {
  return argv.some((a) => names.includes(a));
}

function printUsage(): void {
  console.log(`Usage: ooc init [path] [options]

Scaffold a new OOC World directory at <path> (default: current directory).

Options:
  --name <name>     World name (used in package.json; default: directory basename)
  --force, -f       Continue even if the target directory already has files
  --no-install      Skip running 'bun install' after scaffolding
  -h, --help        Show this help`);
}

async function exec(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

export default async function init(argv: string[]): Promise<void> {
  if (hasFlag(argv, ["-h", "--help"])) {
    printUsage();
    return;
  }

  const positional = argv.filter((a) => !a.startsWith("-"));
  const targetPath = resolve(positional[0] ?? process.cwd());
  const force = hasFlag(argv, ["--force", "-f"]);
  const skipInstall = hasFlag(argv, ["--no-install"]);
  const explicitName = readFlagValue(argv, ["--name"]);
  const worldName = explicitName ?? targetPath.split("/").filter(Boolean).pop() ?? "my-ooc-world";

  // Check directory existence
  if (!force) {
    try {
      const entries = await import("node:fs").then((f) => f.promises.readdir(targetPath));
      if (entries.length > 0) {
        console.error(
          `ooc init: directory '${targetPath}' is not empty. ` +
            `Use --force to scaffold into an existing directory (existing files will not be overwritten).`,
        );
        process.exit(1);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  await mkdir(targetPath, { recursive: true });

  console.log(`[ooc] scaffolding world at ${targetPath}`);

  // package.json (world root)
  await write(join(targetPath, "package.json"), JSON.stringify({
    name: worldName,
    version: "0.1.0",
    private: true,
    type: "module",
    workspaces: ["stones/*"],
    scripts: {
      dev: "ooc dev",
      start: "ooc start",
      build: "ooc build",
    },
    dependencies: {
      "@ooc/core": DEFAULT_OOC_VERSION,
      "@ooc/web": DEFAULT_OOC_VERSION,
      "@ooc/builtins/supervisor": DEFAULT_OOC_VERSION,
      "@ooc/builtins/user": DEFAULT_OOC_VERSION,
      "@ooc/builtins/root": DEFAULT_OOC_VERSION,
      "@ooc/builtins/file": DEFAULT_OOC_VERSION,
      "@ooc/builtins/plan": DEFAULT_OOC_VERSION,
      "@ooc/builtins/todo": DEFAULT_OOC_VERSION,
      "@ooc/builtins/search": DEFAULT_OOC_VERSION,
      "@ooc/builtins/knowledge": DEFAULT_OOC_VERSION,
      "@ooc/builtins/program": DEFAULT_OOC_VERSION,
      "@ooc/builtins/skill_index": DEFAULT_OOC_VERSION,
    },
    devDependencies: {
      "@ooc/cli": DEFAULT_OOC_VERSION,
      "@ooc/tsconfig": DEFAULT_OOC_VERSION,
      "typescript": "^5.9.0",
      "@types/bun": "latest",
      "@types/node": "^25.6.2",
      "@types/react": "^19.2.15",
    },
  }, null, 2) + "\n");

  // tsconfig.json
  await write(join(targetPath, "tsconfig.json"), JSON.stringify({
    extends: "@ooc/tsconfig/world",
    include: ["stones/**/*.ts", "stones/**/*.tsx"],
  }, null, 2) + "\n");

  // .world.json
  await write(join(targetPath, ".world.json"), JSON.stringify({
    port: 3000,
    worker: { enabled: true, pollMs: 100, maxTicks: 15 },
    hotReload: { enabled: true },
    stones: { autoDiscover: true },
  }, null, 2) + "\n");

  // .env.example
  await write(join(targetPath, ".env.example"), [
    "# OOC runtime secrets. Copy to .env before running.",
    "#",
    "# LLM provider — pick one.",
    "ANTHROPIC_API_KEY=",
    "# OPENAI_API_KEY=",
    "",
    "# Lark (Feishu) integration — optional.",
    "# LARK_APP_ID=",
    "# LARK_APP_SECRET=",
    "",
    "# Runtime options.",
    "# OOC_APP_PORT=3000",
    "# OOC_WORKER_ENABLED=1",
    "",
  ].join("\n"));

  // .gitignore
  await write(join(targetPath, ".gitignore"), [
    "node_modules/",
    ".env",
    ".ooc-dist/",
    "flows/",
    "pools/",
    "stones/.stones_repo/",
    "*.log",
    ".DS_Store",
  ].join("\n") + "\n");

  // Ensure pools / flows directories exist (empty, .gitkeep)
  await write(join(targetPath, "flows", ".gitkeep"), "");
  await write(join(targetPath, "pools", ".gitkeep"), "");

  // Builtin Objects (supervisor, user) 的定义由 @ooc/builtins/* npm 包提供，
  // 不在用户 world 的 stones/ 下生成。pool/flow 目录由 runtime 按需创建。
  //
  // 下面生成一个示例 product Agent stone，让用户立刻能看到 stones/ 是怎么组织的。
  const exampleName = "agent_of_product";
  const examplePkg = {
    name: `@${worldName.replace(/[^a-z0-9-_]/g, "-")}/${exampleName}`,
    version: "0.1.0",
    private: true,
    type: "module",
    peerDependencies: { "@ooc/core": DEFAULT_OOC_VERSION },
    ooc: { objectId: exampleName, kind: "stone", type: "agent", prototype: "supervisor" },
  };
  await write(join(targetPath, "stones", exampleName, "package.json"), JSON.stringify(examplePkg, null, 2) + "\n");
  await write(join(targetPath, "stones", exampleName, "self.md"), [
    `# ${exampleName}`,
    "",
    "这是一个示例 Product Agent。你可以：",
    "- 改 self.md 重定义身份",
    "- 加 executable/index.ts 写方法",
    "- 加 visible/index.tsx 写 UI 组件",
    "- 加 knowledge/*.md 注入知识",
    "",
  ].join("\n"));
  await write(join(targetPath, "stones", exampleName, "readable.md"), [
    `## ${exampleName}`,
    "",
    "面向产品场景的 Agent。职责：拆解产品需求、排优先级、跟踪交付。",
    "",
  ].join("\n"));

  console.log(`[ooc] scaffolded world '${worldName}'`);
  console.log(`[ooc]   example stone: agent_of_product`);
  console.log(`[ooc]   built-in agents: supervisor, user (from @ooc/builtins/*, not in stones/)`);
  console.log(`[ooc]   next steps:`);
  console.log(`[ooc]     1. cd ${targetPath}`);
  if (skipInstall) {
    console.log(`[ooc]     2. bun install`);
    console.log(`[ooc]     3. cp .env.example .env  # then fill in API keys`);
    console.log(`[ooc]     4. bun run dev`);
  } else {
    console.log(`[ooc]     2. cp .env.example .env  # then fill in API keys`);
    console.log(`[ooc]     3. bun run dev`);
  }

  if (!skipInstall) {
    if (existsSync(join(targetPath, "package.json"))) {
      console.log("[ooc] running bun install…");
      try {
        await exec("bun", ["install"], targetPath);
        // bun install exit 0 even with resolution warnings, no need to gate.
        // Mark newly-created node_modules as OK.
        void chmod; // reference to avoid unused warning if install fails silently
      } catch (e) {
        console.warn(
          `[ooc] bun install failed: ${e instanceof Error ? e.message : String(e)}\n` +
            `       Run 'bun install' manually inside '${targetPath}' before 'ooc dev'.`,
        );
      }
    }
  }
}
