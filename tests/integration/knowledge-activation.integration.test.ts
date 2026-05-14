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
  countEventsWithPrefix,
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

    const root: ThreadContext = {
      id: "root",
      status: "running",
      events: [
        {
          category: "context_change",
          kind: "inject",
          text: [
            "请帮我数一下 src/persistable/ 下有几个 .ts 文件（不含 __tests__/）。",
            "",
            "建议步骤：",
            "1) open(type=command, command=program) + refine 填入 language='shell' 和 code='find src/persistable -type f -name *.ts -not -path */__tests__/* | wc -l'，然后 submit",
            "2) 看到 form 变成 status=executed 后，result 字段里有数字。open(type=command, command=end) + refine 填入 summary='数字是 N'，submit 结束",
            "",
            "提示：form result 是同步可见的，submit 后下一轮就在 active_forms 中能直接读，不需要 wait。",
          ].join("\n"),
        },
      ],
      contextWindows: [],
      persistence: { ...flow, threadId: "root" },
    };

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");

    // 至少 2 个 form executed（program shell + end）
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(2);

    // 关键断言：读 llm.input.json 解析后看 system message 的 XML 内容。
    // 这比让 LLM 自己复述 marker-7xq9 可靠——不依赖模型是否乖乖按指令重复内容。
    const inputJsonPath = llmInputFile({ ...root.persistence! });
    const record = JSON.parse(await readFile(inputJsonPath, "utf8")) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemContent = record.messages[0]?.content ?? "";
    expect(systemContent).toContain("marker-7xq9");
    expect(systemContent).toContain("<active_knowledge>");
    expect(systemContent).toContain('<knowledge path="shell-cheatsheet" presentation="full">');
  }, 240_000);
});
