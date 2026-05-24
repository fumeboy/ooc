/** 自定义 console，把所有 log/warn/error 文本累积进单个数组，供 executor 收尾。 */
export interface CapturingConsole {
  console: {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  drain: () => string;
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a === null || a === undefined) return String(a);
      try {
        return JSON.stringify(a);
      } catch {
        // intentional: serialization fallback——含 BigInt / circular ref 等 JSON.stringify
        // 拒绝的值时降级为 String(a)。不写 event/warn 是因为这是 sandbox console.log 的
        // 内部细节，对 LLM/observability 无意义。属 meta/observable.silent_swallow_ban
        // 的 sandbox 例外白名单（serialization fallback）。
        return String(a);
      }
    })
    .join(" ");
}

export function createCapturingConsole(): CapturingConsole {
  const buffer: string[] = [];
  const sink = (...args: unknown[]) => {
    buffer.push(format(args));
  };
  return {
    console: { log: sink, warn: sink, error: sink },
    drain: () => buffer.join("\n"),
  };
}
