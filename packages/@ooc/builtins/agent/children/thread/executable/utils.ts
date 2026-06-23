export function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function generateThreadId(): string {
  return `thread_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
