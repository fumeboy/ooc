import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  createFlowObject,
  createStoneObject,
  knowledgeDir,
  llmInputFile,
} from "../../src/persistable";
import {
  bootstrapInboxFromPrompt,
  countFormExecutions,
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import type { ThreadContext } from "../../src/thinkable/context";

/**
 * 验证 knowledge 自动激活闭环：
 * - 预置一篇 knowledge 文档（activates_on.show_content_when = ["program.shell"]）
 * - Agent open program(language=shell) form → 下一轮 system XML 中应出现 <active_knowledge> 含该篇正文
 * - 用 marker-7xq9 这种中性字符串当指纹（避免 "SECRET" 触发模型 safety 模式）
 */
describe.skipIf(!hasLlmEnv)("integration: knowledge-activation", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("knowledge file with show_content_when=program.shell auto-activates", async () => {
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
    const kdir = knowledgeDir(stoneRef);
    await mkdir(kdir, { recursive: true });
    await writeFile(
      join(kdir, "shell-cheatsheet.md"),
      [
        "---",
        "filename: shell-cheatsheet",
        "title: Shell 速查表",
        "description: 常用 shell 模式",
        "activates_on:",
        "  show_content_when: [program.shell]",
        "---",
        "",
        "## marker-7xq9",
        "",
        "数文件数：`find DIR -type f -name '*.ts' | wc -l`",
        "",
        "查 git 状态：`git status --short`",
      ].join("\n")
    );

    // 关键：用两步 open + refine + submit，不一次给齐 args。否则 form 在 open 同一 tick
    // 内 auto-submit 后立即移除，下一轮 render 时 contextWindows 已无 commandPath="program.shell"，
    // activator 永远不会在 LLM 视野里命中。这就是 show_content_when=[program.shell] 这种
    // 「在 form 打开期间显示」语义的本意。
    const { inbox, events } = bootstrapInboxFromPrompt(
      [
        "请帮我数一下 src/persistable/ 下有几个 .ts 文件（不含 __tests__/）。",
        "",
        "**严格分两步打开 program form**（不要一次给齐 args 让 form auto-submit）：",
        "  step A: open(command=\"program\", title=\"统计文件\", args={ language: \"shell\" })",
        "          只声明 language，不传 code——args 不完整，form 会保持 open 状态。",
        "  step B: refine(form_id=<step A 返回的 form_id>, args={ code: \"find src/persistable -type f -name '*.ts' -not -path '*/__tests__/*' | wc -l\" })",
        "          再 submit(form_id=<同上>) 执行。",
        "  step C: 看到 program_window.history 中有数字后，open(command=\"end\", args={ summary: \"数字是 N\" }) 结束。",
        "",
        "提示：result 在 program_window.history 中可见，不需要 wait。",
      ].join("\n"),
    );
    const root: ThreadContext = {
      id: "root",
      status: "running",
      inbox,
      events,
      contextWindows: [],
      persistence: { ...flow, threadId: "root" },
    };

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");

    // 至少 2 个 form executed（program shell + end）
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(2);

    // 关键断言：读 llm.input.json 解析后看 system message 的 XML 内容。
    // 这比让 LLM 自己复述 marker-7xq9 可靠——不依赖模型是否乖乖按指令重复内容。
    //
    // llm.input.json schema（参见 src/persistable/debug-file.ts LlmInputDebugRecord）：
    //   { threadId, inputItems: LlmInputItem[], contextSnapshot }
    // inputItems[0] 是 type=message role=system 的 XML 上下文；旧 schema 用 `messages`，
    // responses-first item model 上线后已统一到 inputItems，这里跟着改。
    const inputJsonPath = llmInputFile({ ...root.persistence! });
    const record = JSON.parse(await readFile(inputJsonPath, "utf8")) as {
      inputItems: Array<{ type: string; role?: string; content?: string }>;
    };
    const systemItem = record.inputItems.find(
      (item) => item.type === "message" && item.role === "system",
    );
    const systemContent = systemItem?.content ?? "";
    expect(systemContent).toContain("marker-7xq9");
    // context-window 统一后（spec 2026-05-14），activator 命中的 knowledge 不再用单独的
    // <active_knowledge> 段，而是合成为 type=knowledge 的 ContextWindow，source=activator。
    expect(systemContent).toContain('type="knowledge"');
    expect(systemContent).toContain("<source>activator</source>");
    expect(systemContent).toContain("shell-cheatsheet");
  }, 240_000);
});
