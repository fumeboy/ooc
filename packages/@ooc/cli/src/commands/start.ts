import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..", "..", "..");
const CORE_SERVER_ENTRY = join(REPO_ROOT, "packages", "@ooc", "core", "app", "server", "index.ts");

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
  console.log(`Usage: ooc start [options]

Start OOC in production mode (backend only).
Serves /api from the Elysia server; frontend should be served from .ooc-dist/ or a reverse proxy.

Options:
  --world <dir>   Path to the OOC world directory (default: $OOC_WORLD_DIR or $PWD)
  --port <port>   Port to listen on (default: $OOC_APP_PORT or 3000)
  --no-worker     Disable the LLM worker thread runner
  -h, --help      Show this help`);
}

/**
 * ooc start — production mode.
 *
 * Starts the backend server without Vite and without hot-reload
 * (OOC_DEV is not set). Static frontend assets are expected to be present at
 * `.ooc-dist/web/` (produced by `ooc build`) or served separately by a reverse
 * proxy.
 *
 * Future: integrate static middleware to serve .ooc-dist/web/*.
 */
export default async function start(argv: string[]): Promise<void> {
  if (hasFlag(argv, ["-h", "--help"])) {
    printUsage();
    return;
  }

  const explicitWorld = readFlagValue(argv, ["--world", "--world-dir", "--base-dir"]);
  const rawWorldDir = explicitWorld ?? process.env.OOC_WORLD_DIR ?? process.env.OOC_BASE_DIR ?? process.cwd();
  const absWorldDir = resolve(rawWorldDir);

  try {
    const s = await stat(absWorldDir);
    if (!s.isDirectory()) throw new Error(`not a directory: ${absWorldDir}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`world directory does not exist: ${absWorldDir}. Run 'ooc init' first.`);
    }
    throw e;
  }

  const explicitPort = readFlagValue(argv, ["--port"]);
  const backendPort = explicitPort ?? process.env.OOC_APP_PORT ?? "3000";
  const noWorker = hasFlag(argv, ["--no-worker"]);

  console.log(`[ooc] world=${absWorldDir}`);
  console.log(`[ooc] mode=production (no hot-reload, no Vite)`);
  console.log(`[ooc] port=${backendPort}${noWorker ? " worker=disabled" : ""}`);

  let shuttingDown = false;
  const shutdown = (child?: ChildProcess) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[ooc] shutting down…");
    if (child && !child.killed) child.kill("SIGTERM");
  };

  const child = spawn(
    process.execPath,
    ["run", CORE_SERVER_ENTRY, "--world", absWorldDir, "--port", String(backendPort)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        OOC_WORLD_DIR: absWorldDir,
        OOC_WORKER_ENABLED: noWorker ? "0" : "1",
        // Explicitly unset OOC_DEV to make sure production mode is enforced even
        // if the caller exported it in their shell.
        OOC_DEV: "",
      },
    },
  );
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[ooc] backend exited with code ${code}`);
    }
    shutdown();
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => shutdown(child));
  process.on("SIGTERM", () => shutdown(child));

  // Block forever.
  await new Promise(() => {});
}
