export class AppServerError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "CONFLICT"
      | "METHOD_NOT_FOUND"
      | "METHOD_LOAD_FAILED"
      | "THREAD_NOT_RUNNABLE"
      | "THREAD_NOT_PAUSED"
      | "JOB_ALREADY_RUNNING"
      | "PAUSE_STILL_ENABLED"
      | "INTERNAL_ERROR",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}
