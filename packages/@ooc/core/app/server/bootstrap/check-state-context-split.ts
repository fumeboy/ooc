/**
 * Bootstrap migration: state (object dim) vs context (thread dim) split — P6.§6.
 *
 * Pre-P6, ContextWindow features (talk/do/method_exec/command_exec/todo) were
 * sometimes persisted as their own `flows/<sid>/<wid>/state.json` directories,
 * and some real flow-object state.json files carried a `contextWindows` field
 * that conflated state (object dim, cross-thread) with context (thread dim,
 * per-thread). The plan §6 split moves both back into their proper homes.
 *
 * This bootstrap step runs the migration idempotently on every server start.
 * It is safe to run on already-clean worlds (which is the steady state after
 * the first run). The migration logic itself lives in
 * `scripts/migrate-state-context-split.ts` and is also runnable from CLI.
 *
 * Failures are logged as a single warning and never abort startup.
 */

import { runMigration } from "../../../../../../scripts/migrate-state-context-split";

export async function checkStateContextSplit(baseDir: string): Promise<void> {
  try {
    const stats = await runMigration({ worldDir: baseDir });
    const changed =
      stats.bogusDirsRemoved +
      stats.bogusEntriesInlined +
      stats.stateJsonsStrippedContextWindows +
      stats.contextWindowsEntriesMoved;
    if (changed > 0) {
      console.warn(
        `[state-context-split] migrated: ` +
          `${stats.bogusDirsRemoved} bogus dir(s) removed, ` +
          `${stats.bogusEntriesInlined} feature(s) inlined, ` +
          `${stats.stateJsonsStrippedContextWindows} state.json contextWindows stripped, ` +
          `${stats.contextWindowsEntriesMoved} entries moved`,
      );
    }
    for (const w of stats.warnings) {
      console.warn(`[state-context-split] ${w}`);
    }
  } catch (e) {
    console.warn(
      `[state-context-split] migration failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
