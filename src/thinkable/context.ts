/**
 * thinkable/context — P2 STUB
 *
 * Re-export of process/thread types needed by debug-file.ts.
 * Full implementation is P4+ (thinkable dimension rebuild in ooc-3).
 */

// Minimal type stubs — structural compatibility only.
// When thinkable is implemented these will be replaced by real types.

export type ProcessEventCommon = {
    id?: string;
    _foldedBy?: string;
};

export type ProcessEvent = ProcessEventCommon & Record<string, unknown>;

export type ThreadMessage = {
    id: string;
    role: string;
    content: string;
    [key: string]: unknown;
};

import type { ContextWindow } from "../executable/windows/_shared/types";
import type { ThreadPersistenceRef } from "../persistable/common";

export type ThreadContext = {
    id: string;
    status?: string;
    contextWindows?: ContextWindow[];
    inbox?: ThreadMessage[];
    outbox?: ThreadMessage[];
    events?: ProcessEvent[];
    creatorThreadId?: string;
    parentThreadId?: string;
    /** Optional disk persistence reference (absent for in-memory / test threads). */
    persistence?: ThreadPersistenceRef;
    [key: string]: unknown;
};
