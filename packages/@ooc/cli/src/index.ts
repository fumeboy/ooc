#!/usr/bin/env bun
/**
 * ooc CLI entry point.
 *
 * In the interim (pre-M5, pre-npm publish) this is a thin dispatcher.
 * Long-term this will be the single entry point for users to interact with
 * OOC Core — init, dev, build, start.
 */
type Command = (args: string[]) => Promise<void> | void;

const commands: Record<string, Command> = {
  init: (await import("./commands/init.js")).default,
  dev: (await import("./commands/dev.js")).default,
  start: (await import("./commands/start.js")).default,
  build: (await import("./commands/build.js")).default,
};

function printUsage(): void {
  console.log(`Usage: ooc <command> [options]

Commands:
  init    Scaffold a new OOC World directory
  dev     Start OOC in development mode (backend + Vite frontend + hot-reload)
  start   Start OOC in production mode (backend only, no hot-reload)
  build   Precompile stones into .ooc-dist/ for production

Run 'ooc <command> --help' for command-specific options.`);
}

const [commandName, ...rest] = process.argv.slice(2);

if (!commandName || commandName === "--help" || commandName === "-h") {
  printUsage();
  process.exit(commandName ? 0 : 1);
}

const cmd = commands[commandName];
if (!cmd) {
  console.error(`ooc: unknown command '${commandName}'`);
  printUsage();
  process.exit(1);
}

try {
  await cmd(rest);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

export {};
