import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
// __filename = <repo>/packages/@ooc/cli/src/commands/dev.ts
// repo root is 5 levels up: cli/src/commands → cli → @ooc → packages → repo
const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..", "..", "..");

const CORE_SERVER_ENTRY = join(REPO_ROOT, "packages", "@ooc", "core", "app", "server", "index.ts");
const WEB_DIR = join(REPO_ROOT, "packages", "@ooc", "web");

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

function printUsage(): void {
  console.log(`Usage: ooc dev [options]

Options:
  --world <dir>   Path to the OOC world directory (default: $OOC_WORLD_DIR or $PWD)
  --port <port>   Backend port (default: $OOC_APP_PORT or 3000)
  -h, --help      Show this help`);
}

/**
 * ooc dev — start the OOC dev stack.
 *
 * Thin wrapper that spawns two child processes.
 * - Backend: bun run packages/@ooc/core/app/server/index.ts --world <world>
 * - Frontend: bunx vite inside packages/@ooc/web with OOC_WORLD_DIR forwarded
 *
 * This phase intentionally does not restructure anything. Both processes are
 * started the same way a developer would start them manually, and they keep
 * their existing port arrangement (Vite owns the user-facing port and proxies
 * /api to the backend).
 */
export default async function dev(argv: string[]): Promise<void> {
  if (argv.includes("-h") || argv.includes("--help")) {
    printUsage();
    return;
  }

  const explicitWorld = readFlagValue(argv, ["--world", "--world-dir", "--base-dir"]);
  const rawWorldDir = explicitWorld ?? process.env.OOC_WORLD_DIR ?? process.env.OOC_BASE_DIR ?? process.cwd();
  const absWorldDir = resolve(rawWorldDir);

  const explicitPort = readFlagValue(argv, ["--port"]);
  const backendPort = explicitPort ?? process.env.OOC_APP_PORT ?? "3000";

  console.log(`[ooc] world=${absWorldDir}`);
  console.log(`[ooc] backend port=${backendPort} (Vite will proxy /api here)`);

  const children: ChildProcess[] = [];

  const spawnBackend = (): ChildProcess => {
    const proc = spawn(
      process.execPath,
      ["run", CORE_SERVER_ENTRY, "--world", absWorldDir, "--port", String(backendPort)],
      {
        stdio: "inherit",
        env: { ...process.env, OOC_WORLD_DIR: absWorldDir, OOC_DEV: "1" },
      },
    );
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[ooc] backend exited with code ${code}`);
      }
      shutdown();
    });
    return proc;
  };

  const spawnFrontend = (): ChildProcess => {
    const proc = spawn(
      process.execPath,
      ["x", "vite"],
      {
        stdio: "inherit",
        cwd: WEB_DIR,
        env: {
          ...process.env,
          OOC_WORLD_DIR: absWorldDir,
          OOC_API_TARGET: `http://127.0.0.1:${backendPort}`,
        },
      },
    );
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[ooc] frontend exited with code ${code}`);
      }
      shutdown();
    });
    return proc;
  };

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[ooc] shutting down…");
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  children.push(spawnBackend());
  children.push(spawnFrontend());

  // Block forever (the child processes own stdio).
  await new Promise(() => {});
}
