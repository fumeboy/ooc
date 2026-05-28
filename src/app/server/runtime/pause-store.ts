/**
 * pause-store — P2 STUB
 * Originally imported by config.ts for ServerConfig.pauseStore field.
 * Import removed from config.ts in Drift 3 cleanup (2026-05-28).
 *
 * _todo: P8+ implement properly — global + per-session pause gate,
 * plumbed into worker tick to gate LLM calls.
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
