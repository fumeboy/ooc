/**
 * Re-export from the canonical source at src/executable/windows/_shared/types.ts.
 * Phase 1 migration: new location exists as re-export; canonical source stays in old location.
 * During Phase 4, each builtin object will migrate to this directory structure.
 */
export * from "../../executable/windows/_shared/types";
