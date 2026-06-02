// P6.§9 (2026-06-02): executable/ + readable.ts have moved to
// `packages/@ooc/core/executable/windows/method_exec/`.
// This barrel keeps the type re-export and visible component for backward-compat with
// existing callers (one release window before the package is fully removed in §10).
export type * from "./types.js";
export { default as WindowDetail } from "./visible/index.js";
