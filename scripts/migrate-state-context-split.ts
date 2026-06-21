/**
 * migration — split state (object dim) from context (thread dim).
 *
 * What this fixes (legacy on-disk shape from before this split):
 *   - Built-in feature ContextWindows (talk/do/method_exec/command_exec/todo)
 *     were each given their own `flows/<sid>/<wid>/state.json` directory at
 *     the same level as user/supervisor/plan/etc — but they're not stand-alone
 *     objects, they're ephemeral parts of a thread's context.
 *   - Some independent flow-object state.json files carried a `contextWindows`
 *     field that conflated state (object dim) with context (thread dim).
 *
 * What this script does (idempotent):
 *   1. Walk every `flows/<sid>/<oid>/state.json`. If the recorded `type` is a
 *      built-in feature, the directory is bogus — find the parent thread
 *      (whichever thread among the *real* flow-objects in this session has it
 *      in its in-memory contextWindows registry, or — fallback — append it
 *      under the session's first user/supervisor root thread). Inline its
 *      state into that thread-context.json and rm-rf the bogus dir.
 *   2. Walk every remaining `flows/<sid>/<oid>/state.json`. If it has a
 *      `contextWindows` field, lift those entries into
 *      `<oid>/threads/<tid>/thread-context.json` (the matching thread per
 *      the legacy ThreadContext schema where contextWindows lived under
 *      `thread.json`), then strip the field from state.json.
 *
 * Usage (CLI):
 *   bun run scripts/migrate-state-context-split.ts --world ./.ooc-world-test
 *
 * Idempotent — re-runs find nothing left to do.
 *
 * One-shot CLI tool — NOT wired into server bootstrap; run manually when an old
 * state.json-layout world needs migrating. `runMigration` is exported as a library
 * entry only for callers that choose to invoke it programmatically.
 */

import { readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

interface RunOpts {
  worldDir: string;
  dryRun?: boolean;
}

const BUILTIN_FEATURE_TYPES = new Set([
  "talk",
  "do",
  "todo",
  "method_exec",
  "command_exec",
]);

export interface MigrationStats {
  bogusDirsRemoved: number;
  bogusEntriesInlined: number;
  stateJsonsStrippedContextWindows: number;
  contextWindowsEntriesMoved: number;
  warnings: string[];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  if (!(await pathExists(p))) return null;
  return JSON.parse(await readFile(p, "utf8")) as T;
}

async function listSessions(flowsDir: string): Promise<string[]> {
  if (!(await pathExists(flowsDir))) return [];
  const entries = await readdir(flowsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listObjects(sessionDir: string): Promise<string[]> {
  if (!(await pathExists(sessionDir))) return [];
  const entries = await readdir(sessionDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listThreads(objectDir: string): Promise<string[]> {
  const threadsDir = join(objectDir, "threads");
  if (!(await pathExists(threadsDir))) return [];
  const entries = await readdir(threadsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function migrateState(
  sessionDir: string,
  oid: string,
  dryRun: boolean,
  stats: MigrationStats,
): Promise<void> {
  const objectDir = join(sessionDir, oid);
  const stateFile = join(objectDir, "state.json");
  const state = await readJson<Record<string, unknown>>(stateFile);
  if (!state) return;
  if (!("contextWindows" in state)) return;
  const cw = state.contextWindows;
  if (!Array.isArray(cw) || cw.length === 0) {
    delete state.contextWindows;
    if (!dryRun) await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
    stats.stateJsonsStrippedContextWindows++;
    return;
  }

  const threads = await listThreads(objectDir);
  if (threads.length === 0) {
    stats.warnings.push(
      `state.json at ${stateFile} carries contextWindows (${cw.length} entries) but the object has no threads/ dir; left untouched.`,
    );
    return;
  }
  const tid = threads[0]!;
  if (threads.length > 1) {
    stats.warnings.push(
      `state.json at ${stateFile} carries contextWindows but object has ${threads.length} threads; merging into first (${tid}). Verify manually.`,
    );
  }

  const tcFile = join(objectDir, "threads", tid, "thread-context.json");
  const existing = await readJson<{ threadId: string; contextWindows: unknown[] }>(tcFile);
  const merged = existing
    ? { threadId: existing.threadId ?? tid, contextWindows: [...existing.contextWindows, ...cw] }
    : { threadId: tid, contextWindows: cw };
  if (!dryRun) {
    await mkdir(dirname(tcFile), { recursive: true });
    await writeFile(tcFile, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }
  stats.contextWindowsEntriesMoved += cw.length;

  delete state.contextWindows;
  if (!dryRun) await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
  stats.stateJsonsStrippedContextWindows++;
}

async function migrateBogusBuiltinFeatureDir(
  sessionDir: string,
  bogusOid: string,
  dryRun: boolean,
  stats: MigrationStats,
  realObjectIds: string[],
): Promise<boolean> {
  const objectDir = join(sessionDir, bogusOid);
  const stateFile = join(objectDir, "state.json");
  const state = await readJson<{ type?: string; id?: string }>(stateFile);
  if (!state) return false;
  const t = typeof state.type === "string" ? state.type : "";
  if (!BUILTIN_FEATURE_TYPES.has(t)) return false;

  const wid = state.id ?? bogusOid;

  let attached = false;
  outer: for (const realOid of realObjectIds) {
    const realObjDir = join(sessionDir, realOid);
    const tids = await listThreads(realObjDir);
    for (const tid of tids) {
      const tcFile = join(realObjDir, "threads", tid, "thread-context.json");
      const tcFileLegacy = join(realObjDir, "threads", tid, "context.json");
      const tc = await readJson<{ threadId: string; contextWindows: unknown[] }>(tcFile);
      const tcLegacy = !tc ? await readJson<{ threadId: string; contextWindows: unknown[] }>(tcFileLegacy) : null;
      const target = tc ?? tcLegacy;
      if (!target) continue;
      const cwArr = Array.isArray(target.contextWindows) ? target.contextWindows : [];
      const idx = cwArr.findIndex(
        (e: any) => e && typeof e === "object" && e.id === wid,
      );
      if (idx === -1) continue;
      cwArr[idx] = state;
      const out = { threadId: target.threadId ?? tid, contextWindows: cwArr };
      const outFile = tc ? tcFile : tcFileLegacy;
      if (!dryRun) {
        await mkdir(dirname(outFile), { recursive: true });
        await writeFile(outFile, JSON.stringify(out, null, 2) + "\n", "utf8");
      }
      stats.bogusEntriesInlined++;
      attached = true;
      break outer;
    }
  }

  if (!attached) {
    const firstReal = realObjectIds[0];
    if (firstReal) {
      const realObjDir = join(sessionDir, firstReal);
      const tids = await listThreads(realObjDir);
      const tid = tids[0];
      if (tid) {
        const tcFile = join(realObjDir, "threads", tid, "thread-context.json");
        const tc = await readJson<{ threadId: string; contextWindows: unknown[] }>(tcFile);
        const cwArr = (tc?.contextWindows ?? []) as unknown[];
        cwArr.push(state);
        const out = { threadId: tc?.threadId ?? tid, contextWindows: cwArr };
        if (!dryRun) {
          await mkdir(dirname(tcFile), { recursive: true });
          await writeFile(tcFile, JSON.stringify(out, null, 2) + "\n", "utf8");
        }
        stats.bogusEntriesInlined++;
        attached = true;
        stats.warnings.push(
          `Bogus built-in feature dir ${objectDir} (id=${wid}, type=${t}) was not referenced by any thread; appended under ${firstReal}/${tid}.`,
        );
      }
    }
  }

  if (!attached) {
    stats.warnings.push(
      `Bogus built-in feature dir ${objectDir} (id=${wid}, type=${t}): no real object/thread to attach to; left untouched.`,
    );
    return false;
  }

  if (!dryRun) await rm(objectDir, { recursive: true, force: true });
  stats.bogusDirsRemoved++;
  return true;
}

async function migrateSession(
  flowsDir: string,
  sessionId: string,
  dryRun: boolean,
  stats: MigrationStats,
): Promise<void> {
  const sessionDir = join(flowsDir, sessionId);
  const oids = await listObjects(sessionDir);

  const realOids: string[] = [];
  const bogusOids: string[] = [];
  for (const oid of oids) {
    const stateFile = join(sessionDir, oid, "state.json");
    const state = await readJson<{ type?: string }>(stateFile);
    if (!state) continue;
    const t = typeof state.type === "string" ? state.type : "";
    if (BUILTIN_FEATURE_TYPES.has(t)) bogusOids.push(oid);
    else realOids.push(oid);
  }

  for (const bogusOid of bogusOids) {
    await migrateBogusBuiltinFeatureDir(sessionDir, bogusOid, dryRun, stats, realOids);
  }

  for (const realOid of realOids) {
    await migrateState(sessionDir, realOid, dryRun, stats);
  }
}

/** Library entry — invoke programmatically or via this script's CLI (not auto-run at bootstrap). */
export async function runMigration(opts: RunOpts): Promise<MigrationStats> {
  const flowsDir = join(opts.worldDir, "flows");
  const dryRun = !!opts.dryRun;
  const stats: MigrationStats = {
    bogusDirsRemoved: 0,
    bogusEntriesInlined: 0,
    stateJsonsStrippedContextWindows: 0,
    contextWindowsEntriesMoved: 0,
    warnings: [],
  };

  const sessions = await listSessions(flowsDir);
  for (const sid of sessions) {
    await migrateSession(flowsDir, sid, dryRun, stats);
  }
  return stats;
}

interface CliArgs {
  world: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = { world: "", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--world") args.world = argv[++i] ?? "";
    else if (a === "--dry-run") args.dryRun = true;
  }
  if (!args.world) {
    console.error("usage: migrate-state-context-split.ts --world <path> [--dry-run]");
    process.exit(2);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stats = await runMigration({ worldDir: args.world, dryRun: args.dryRun });
  console.log(`migrate-state-context-split: ${args.dryRun ? "[DRY RUN] " : ""}done`);
  console.log(`  bogus built-in feature dirs removed   : ${stats.bogusDirsRemoved}`);
  console.log(`  built-in feature entries inlined      : ${stats.bogusEntriesInlined}`);
  console.log(`  state.json contextWindows stripped    : ${stats.stateJsonsStrippedContextWindows}`);
  console.log(`  context entries moved                  : ${stats.contextWindowsEntriesMoved}`);
  if (stats.warnings.length) {
    console.log(`\n  warnings (${stats.warnings.length}):`);
    for (const w of stats.warnings) console.log(`    - ${w}`);
  }
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  /migrate-state-context-split\.ts$/.test(process.argv[1]);

if (isMain) {
  main().catch((e) => {
    console.error("[migrate-state-context-split] FATAL:", e);
    process.exit(1);
  });
}
