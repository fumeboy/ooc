/**
 * debug-store — runtime toggle for loop debug capture.
 *
 * When enabled, thinkloop.ts writes loop_NNNN.{input,output,meta}.json
 * after each LLM tick to:
 *   flows/<sessionId>/objects/<objectName>/threads/<threadId>/debug/
 *
 * Toggle:
 *   - env  OOC_DEBUG_LOOPS=1  → enabled at startup
 *   - POST /api/runtime/debug/enable  → runtime enable
 *   - POST /api/runtime/debug/disable → runtime disable
 *
 * Default: ON when OOC_DEBUG_LOOPS=1 is set, otherwise OFF.
 */

export interface DebugStore {
    isEnabled(): boolean;
    enable(): void;
    disable(): void;
}

export function createDebugStore(): DebugStore {
    // Default: enabled when OOC_DEBUG_LOOPS=1 env var is set
    let enabled = process.env["OOC_DEBUG_LOOPS"] === "1";

    return {
        isEnabled: () => enabled,
        enable: () => { enabled = true; },
        disable: () => { enabled = false; },
    };
}

/** Singleton used by HTTP layer and thinkloop when no explicit instance is passed. */
let _globalStore: DebugStore | undefined;

export function getGlobalDebugStore(): DebugStore {
    if (!_globalStore) {
        _globalStore = createDebugStore();
    }
    return _globalStore;
}
