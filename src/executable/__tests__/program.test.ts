import { describe, expect, it } from "bun:test";
import { executeProgramCommand } from "../commands/program";
import type { ThreadContext } from "../../thinkable/context";

function makeCtx(args: Record<string, unknown>) {
  const thread: ThreadContext = { id: "t", status: "running", events: [] };
  return { thread, args };
}

describe("program.shell", () => {
  it("returns formatted result for a successful command", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell", code: "echo hello" }));
    expect(result).toContain("$ echo hello");
    expect(result).toContain("[stdout]");
    expect(result).toContain("hello");
    expect(result).toContain("[exit 0]");
  });

  it("captures non-zero exit code", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell", code: "exit 7" }));
    expect(result).toContain("[exit 7]");
  });

  it("captures stderr", async () => {
    const result = await executeProgramCommand(
      makeCtx({ language: "shell", code: "echo bad >&2; exit 1" })
    );
    expect(result).toContain("[stderr]");
    expect(result).toContain("bad");
    expect(result).toContain("[exit 1]");
  });

  it("truncates oversize stdout", async () => {
    const result = await executeProgramCommand(
      makeCtx({ language: "shell", code: "head -c 8192 /dev/zero | tr '\\0' 'a'" })
    );
    expect(result).toContain("...[truncated, original");
  });

  it("rejects non-shell language with explicit message", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "ts", code: "console.log(1)" }));
    expect(result).toContain("本阶段仅支持 language=\"shell\"");
  });

  it("rejects missing code", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell" }));
    expect(result).toContain("缺少 code 参数");
  });
});
