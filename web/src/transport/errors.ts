export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function messageFromError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
