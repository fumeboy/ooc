/**
 * pause-store — P2 STUB
 * Minimal interface stub for config.ts dependency resolution.
 * Full implementation in ooc-3 server rebuild phase (P7+).
 */

export interface PauseStore {
    enableGlobalPause(): void;
    disableGlobalPause(): void;
    isGlobalPauseEnabled(): boolean;
    pauseSession(sessionId: string): void;
    resumeSession(sessionId: string): void;
    isSessionPaused(sessionId: string): boolean;
}

export function createPauseStore(): PauseStore {
    const pausedSessions = new Set<string>();
    let globalPaused = false;
    return {
        enableGlobalPause: () => { globalPaused = true; },
        disableGlobalPause: () => { globalPaused = false; },
        isGlobalPauseEnabled: () => globalPaused,
        pauseSession: (sessionId) => { pausedSessions.add(sessionId); },
        resumeSession: (sessionId) => { pausedSessions.delete(sessionId); },
        isSessionPaused: (sessionId) => pausedSessions.has(sessionId),
    };
}
