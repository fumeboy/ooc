/**
 * executable/windows/_shared/types — P2 STUB
 *
 * Minimal type stubs for ContextWindow, FileWindow, RootWindow used by:
 * - persistable/debug-file.ts (ContextWindow, contextSnapshot)
 * - observable/window-hash.ts (ContextWindow, FileWindow)
 * - observable tests (RootWindow)
 *
 * In ooc-3 the Window model is unified under the ObjectRecord/归一 spec.
 * These stubs satisfy type-checking during P2 phase.
 */

export type WindowType = string;
export type WindowStatus = string;

/** Base properties shared by all context windows. */
export interface BaseContextWindow {
    id: string;
    type: WindowType;
    status?: WindowStatus;
    /** Optional parent window id for nested/child windows. */
    parentWindowId?: string;
    /**
     * Compression level for context budget management.
     * 0 = uncompressed (default, not stored), 1 = light, 2 = heavy.
     */
    compressLevel?: 0 | 1 | 2;
    /** File path (used by file_window type). */
    path?: string;
    [key: string]: unknown;
}

export type ContextWindow = BaseContextWindow;

/** file_window type — wraps a file with viewport. */
export interface FileWindow extends BaseContextWindow {
    type: "file";
    status: "open" | "closed";
    /** Absolute or cwd-relative file path. */
    path: string;
    lines?: [number, number];
    columns?: [number, number];
}

/** root_window type — implicit per-thread root. */
export interface RootWindow extends BaseContextWindow {
    type: "root";
    status: "active";
}
