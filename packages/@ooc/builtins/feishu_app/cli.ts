/**
 * lark-cli 子进程调用层 — feishu 集成共用的对外端口。
 *
 * 设计要点：
 * - 唯一访问飞书 OAPI 的通道；feishu_chat / feishu_doc 的方法实现不允许直接 spawn lark-cli。
 * - 鉴权完全由 lark-cli 自己管（OS keychain / device-code flow），OOC 不复制存储 secret。
 * - 默认 `--format json`，错误统一抛 LarkCliError，便于 observable 落盘与 reflectable 沉淀。
 * - 写类副作用必须显式 dryRun=true 走一遍预览，再二次确认（强制 dry-run gate）。
 *
 * 不负责：
 * - 重试 / 配额（暂留 future work，未引入复杂调度器）。
 * - 凭证 init / OAuth login（用户在终端跑 `lark-cli config init` / `lark-cli auth login`）。
 */

export interface LarkExecOptions {
  /** 命令以哪个身份执行；缺省 user。群聊 send 类命令请显式传 "bot"。 */
  as?: "bot" | "user";
  /** 写类方法必须 true 至少跑一次预览；细节由 method 控制。 */
  dryRun?: boolean;
  /** 进程超时（毫秒）；缺省 30s。 */
  timeoutMs?: number;
  /** 是否追加 `--page-all`；只对支持分页的 list/search 类命令有意义。 */
  pageAll?: boolean;
  /** 追加额外 cli 参数（不需要 `--format json` / `--as` / `--dry-run`，本层会处理）。 */
  extraArgs?: string[];
}

export type LarkExecResult =
  | { ok: true; data: unknown; raw: string; durationMs: number }
  | { ok: false; error: string; stderr: string; exitCode: number; raw: string; durationMs: number };

/** 自定义错误类型，给 reflectable 沉淀分类用。 */
export class LarkCliError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "LarkCliError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const LARK_CLI_BIN = process.env.LARK_CLI_BIN ?? "lark-cli";

/**
 * 执行 lark-cli 命令并解析 JSON 输出。
 *
 * args 是面向 lark-cli 的"业务参数"——例如 ["im", "+messages-list", "--chat-id", "oc_xxx"]。
 * 本函数会自动追加：
 * - --as <bot|user>（若 opts.as 非空）
 * - --dry-run（若 opts.dryRun=true）
 * - --page-all（若 opts.pageAll=true）
 * - opts.extraArgs（按原样追加）
 *
 * 返回成功/失败的 discriminated union；不抛出（除非进程 spawn 完全失败）。
 */
export async function larkExec(
  args: string[],
  opts: LarkExecOptions = {},
): Promise<LarkExecResult> {
  // lark-cli 默认输出就是 JSON，且部分 mutation 命令不接受 --format flag。故本层不显式传 --format。
  const fullArgs = [...args];
  if (opts.as) fullArgs.push("--as", opts.as);
  if (opts.dryRun) fullArgs.push("--dry-run");
  if (opts.pageAll) fullArgs.push("--page-all");
  if (opts.extraArgs?.length) fullArgs.push(...opts.extraArgs);

  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Bun.spawn 是 OOC 项目的标准子进程入口（package 用 bun runtime）。
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([LARK_CLI_BIN, ...fullArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    return {
      ok: false,
      error: `spawn lark-cli failed: ${(err as Error).message}（请确认已安装 ${LARK_CLI_BIN}：npx @larksuite/cli@latest install）`,
      stderr: "",
      exitCode: -1,
      raw: "",
      durationMs: Date.now() - start,
    };
  }

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
  }, timeoutMs);

  let raw = "";
  let stderr = "";
  let exitCode = 0;
  try {
    [raw, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - start;

  if (exitCode !== 0) {
    return {
      ok: false,
      error: `lark-cli exit ${exitCode}: ${truncate(stderr || raw, 1024)}`,
      stderr,
      exitCode,
      raw,
      durationMs,
    };
  }

  let parsed: unknown;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : null;
  } catch (err) {
    return {
      ok: false,
      error: `lark-cli stdout 不是合法 JSON（${(err as Error).message}）`,
      stderr,
      exitCode,
      raw,
      durationMs,
    };
  }

  return { ok: true, data: parsed, raw, durationMs };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `…(${text.length - max} more bytes)`;
}

/**
 * 检查鉴权状态（lark-cli auth status）。窗口在 send/patch 等敏感命令前应先调用一次，
 * 失败则把"请先 lark-cli auth login"作为人话错误返回。
 */
export async function larkCheckAuth(as?: "bot" | "user"): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await larkExec(["auth", "status"], { as, timeoutMs: 5_000 });
  if (r.ok) return { ok: true };
  return {
    ok: false,
    reason: `lark-cli 鉴权未就绪：${r.error}\n请先在终端跑 \`lark-cli config init\` 配置应用凭证，再 \`lark-cli auth login --recommend\` 完成 OAuth。`,
  };
}
