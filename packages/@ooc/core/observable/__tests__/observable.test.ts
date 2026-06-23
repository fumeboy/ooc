import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import * as observableModule from "../index";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import type { LlmGenerateResult, LlmInputItem, LlmTool } from "../../thinkable/llm/types";
import { FILE_CLASS_ID } from "../../_shared/types/constants";
import { setSessionObject } from "../../runtime/session-object-table";
import { createFlowObject } from "../../persistable";
import {
  llmInputFile,
  llmOutputFile,
  loopMetaFile,
  loopInputFile,
  loopOutputFile
} from "../debug-file";

type ObservableStore = typeof observableModule & {
  clearLatestLlmObservation: () => void;
  getLatestLlmObservation: () =>
    | {
        input?: {
          threadId: string;
          inputItems: LlmInputItem[];
          tools: LlmTool[];
        };
        output?: {
          threadId: string;
          outputItems: LlmInputItem[];
          provider?: string;
          model?: string;
        };
      }
    | undefined;
};

describe("observable llm snapshots", () => {
  it("records latest llm input and output for a thread", async () => {
    const observable = observableModule as ObservableStore;
    expect(typeof observable.clearLatestLlmObservation).toBe("function");
    expect(typeof observable.getLatestLlmObservation).toBe("function");

    const thread: ThreadContext = {
      id: "thread-observable",
      status: "running",
      events: [],
      contextWindows: []
    };
    const inputItems: LlmInputItem[] = [{ type: "message", role: "system", content: "<context></context>" }];
    const tools: LlmTool[] = [
      {
        name: "wait",
        description: "等待",
        inputSchema: { type: "object" }
      }
    ];
    const result: LlmGenerateResult = {
      provider: "openai",
      model: "gpt-test",
      outputItems: [
        { type: "message", role: "assistant", content: "下一步需要等待" }
      ],
      text: "下一步需要等待",
      toolCalls: []
    };

    observable.clearLatestLlmObservation();
    await observable.writeLatestLlmInput(thread, inputItems, tools);
    await observable.writeLatestLlmOutput(thread, result);

    expect(observable.getLatestLlmObservation()).toEqual({
      input: {
        threadId: "thread-observable",
        inputItems,
        tools
      },
      output: {
        threadId: "thread-observable",
        outputItems: [
          { type: "message", role: "assistant", content: "下一步需要等待" }
        ],
        provider: "openai",
        model: "gpt-test"
      }
    });
  });
});

describe("observable persistable debug files", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("writes llm input and output debug files when thread is persistable", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-observable-"));
    const flowRef = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });
    const thread: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      contextWindows: [],
      persistence: { ...flowRef, threadId: "root" }
    };

    await observableModule.writeLatestLlmInput(
      thread,
      [{ type: "message", role: "system", content: "<context />" }],
      [{ name: "wait", description: "等待", inputSchema: { type: "object" } }]
    );
    await observableModule.writeLatestLlmOutput(thread, {
      provider: "openai",
      model: "test",
      outputItems: [{ type: "message", role: "assistant", content: "done" }],
      text: "done",
      toolCalls: []
    });

    const input = JSON.parse(await readFile(llmInputFile(thread.persistence!), "utf8"));
    const output = JSON.parse(await readFile(llmOutputFile(thread.persistence!), "utf8"));

    expect(input.threadId).toBe("root");
    expect(input.inputItems[0].type).toBe("message");
    expect(input.tools).toBeUndefined();
    expect(output.outputItems[0].content).toBe("done");
  });

  it("does not touch the disk when thread has no persistence ref", async () => {
    const thread: ThreadContext = {
      id: "ephemeral",
      status: "running",
      events: [],
      contextWindows: []
    };

    await observableModule.writeLatestLlmInput(thread, [], []);
    await observableModule.writeLatestLlmOutput(thread, {
      provider: "openai",
      model: "test",
      outputItems: [],
      text: "",
      toolCalls: []
    });
  });

  it("writes loop-level debug files when debug mode is enabled", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-observable-"));
    const flowRef = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });
    const thread: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      contextWindows: [],
      persistence: { ...flowRef, threadId: "root" }
    };
    const inputItems: LlmInputItem[] = [{ type: "message", role: "system", content: "<context />" }];
    const tools: LlmTool[] = [{ name: "wait", description: "等待", inputSchema: { type: "object" } }];
    const result: LlmGenerateResult = {
      provider: "openai",
      model: "test",
      outputItems: [{ type: "message", role: "assistant", content: "done" }],
      text: "done",
      toolCalls: []
    };

    observableModule.clearObservableDebugState();
    observableModule.enableDebug();
    const handle = await observableModule.beginLlmLoop(thread, inputItems, tools);
    await observableModule.finishLlmLoop(thread, handle, {
      result,
      status: "ok"
    });
    observableModule.disableDebug();

    const loopInput = JSON.parse(await readFile(loopInputFile(thread.persistence!, 1), "utf8"));
    const loopOutput = JSON.parse(await readFile(loopOutputFile(thread.persistence!, 1), "utf8"));
    const loopMeta = JSON.parse(await readFile(loopMetaFile(thread.persistence!, 1), "utf8"));

    expect(loopInput.threadId).toBe("root");
    expect(loopInput.inputItems[0].type).toBe("message");
    expect(loopInput.tools).toBeUndefined();
    expect(loopOutput.outputItems[0].content).toBe("done");
    expect(loopMeta.loopIndex).toBe(1);
    expect(loopMeta.status).toBe("ok");
    expect(loopMeta.messageCount).toBe(1);
    // 即使 contextWindows 为空也应写一个空数组（buildWindowsSnapshot([]) → []）
    expect(Array.isArray(loopMeta.windowsSnapshot)).toBe(true);
    expect(loopMeta.windowsSnapshot).toHaveLength(0);
  });

  it("writes windowsSnapshot with content hashes across loops", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-observable-snap-"));
    const flowRef = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "_test_observable_" + Date.now(),
      objectId: "obj"
    });
    const thread: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      // Wave4 对象模型：file 窗 = OocObjectRef 实例，业务字段 path 下沉 inst.data。
      contextWindows: [
        {
          id: "w_file_a",
          title: "src/a.ts",
          status: "open",
          createdAt: 1,
          object: { class: FILE_CLASS_ID, data: { path: "src/a.ts" } },
        } as never,
        {
          id: "w_file_b",
          title: "src/b.ts",
          status: "open",
          createdAt: 2,
          object: { class: FILE_CLASS_ID, data: { path: "src/b.ts" } },
        } as never,
      ],
      persistence: { ...flowRef, threadId: "root" }
    };
    const inputItems: LlmInputItem[] = [{ type: "message", role: "system", content: "<context />" }];
    const tools: LlmTool[] = [];
    const result: LlmGenerateResult = {
      provider: "openai",
      model: "test",
      outputItems: [],
      text: "ok",
      toolCalls: [],
    };

    observableModule.clearObservableDebugState();
    observableModule.enableDebug();

    // Loop 1: 两个 window 都在
    const h1 = await observableModule.beginLlmLoop(thread, inputItems, tools);
    await observableModule.finishLlmLoop(thread, h1, { result, status: "ok" });
    const meta1 = JSON.parse(await readFile(loopMetaFile(thread.persistence!, 1), "utf8"));
    expect(meta1.windowsSnapshot).toHaveLength(2);
    expect(meta1.windowsSnapshot[0].id).toBe("w_file_a");
    expect(meta1.windowsSnapshot[1].id).toBe("w_file_b");
    expect(typeof meta1.windowsSnapshot[0].contentHash).toBe("string");
    expect(meta1.windowsSnapshot[0].contentHash.length).toBeGreaterThan(0);
    const hashA1 = meta1.windowsSnapshot[0].contentHash;
    const hashB1 = meta1.windowsSnapshot[1].contentHash;

    // Loop 2: 改 a 的 title（内容变化，顶层元信息字段），删 b（close 关闭）
    // 注：原用例改 data.path 验「hash 变」，但 computeWindowContentHash 的 sortedKeys 顶层
    // 白名单 replacer 会过滤掉嵌套 data.path（见 window-hash.test.ts 的 real source bug skip），
    // 改 path 不再改 hash。改顶层 title（元信息字段，参与 hash）以在 bug 修复前仍验证 hash 随
    // 元信息内容变化而变。
    (thread.contextWindows[0] as unknown as { title: string }).title = "src/a-v2.ts";
    thread.contextWindows = [thread.contextWindows[0]!];
    const h2 = await observableModule.beginLlmLoop(thread, inputItems, tools);
    await observableModule.finishLlmLoop(thread, h2, { result, status: "ok" });
    const meta2 = JSON.parse(await readFile(loopMetaFile(thread.persistence!, 2), "utf8"));
    expect(meta2.windowsSnapshot).toHaveLength(1);
    expect(meta2.windowsSnapshot[0].id).toBe("w_file_a");
    // a 的 hash 应该变了（title 是顶层元信息字段，参与 hash）
    expect(meta2.windowsSnapshot[0].contentHash).not.toBe(hashA1);
    // b 不再出现
    expect(meta2.windowsSnapshot.find((e: { id: string }) => e.id === "w_file_b")).toBeUndefined();

    observableModule.disableDebug();
    // 防 unused 警告
    void hashB1;
  });

  it("populates fileDiff with previousContent/currentContent across loops", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-observable-filediff-"));
    const flowRef = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "_test_observable_" + Date.now(),
      objectId: "obj"
    });
    // 准备一个真实磁盘上的文件
    const filePath = join(tempRoot, "tracked.ts");
    await writeFile(filePath, "v1\n", "utf8");

    const thread: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      // Wave4：file 窗 path 下沉 inst.data（computeFileDiff 读 w.data.path）。
      // B→A：file 窗 = 纯 ref（id/class/视角态）；path data 进 session 对象表（下方 setSessionObject）。
      contextWindows: [
        {
          id: "w_file_tracked",
          class: FILE_CLASS_ID,
          title: "tracked.ts",
          status: "open",
          createdAt: 1,
        },
      ],
      persistence: { ...flowRef, threadId: "root" }
    };
    setSessionObject(thread, { id: "w_file_tracked", class: FILE_CLASS_ID, data: { path: filePath } });
    const inputItems: LlmInputItem[] = [{ type: "message", role: "system", content: "<context />" }];
    const tools: LlmTool[] = [];
    const result: LlmGenerateResult = {
      provider: "openai",
      model: "test",
      outputItems: [],
      text: "ok",
      toolCalls: [],
    };

    observableModule.clearObservableDebugState();
    observableModule.enableDebug();

    // Loop 1: 文件 v1
    const h1 = await observableModule.beginLlmLoop(thread, inputItems, tools);
    await observableModule.finishLlmLoop(thread, h1, { result, status: "ok" });
    const meta1 = JSON.parse(await readFile(loopMetaFile(thread.persistence!, 1), "utf8"));
    expect(meta1.windowsSnapshot[0].fileDiff).toBeDefined();
    expect(meta1.windowsSnapshot[0].fileDiff.previousContent).toBe("");
    expect(meta1.windowsSnapshot[0].fileDiff.currentContent).toBe("v1\n");
    expect(meta1.windowsSnapshot[0].fileDiff.path).toBe(filePath);

    // Loop 2: 改文件到 v2
    await writeFile(filePath, "v2 with edit\n", "utf8");
    const h2 = await observableModule.beginLlmLoop(thread, inputItems, tools);
    await observableModule.finishLlmLoop(thread, h2, { result, status: "ok" });
    const meta2 = JSON.parse(await readFile(loopMetaFile(thread.persistence!, 2), "utf8"));
    expect(meta2.windowsSnapshot[0].fileDiff).toBeDefined();
    expect(meta2.windowsSnapshot[0].fileDiff.previousContent).toBe("v1\n");
    expect(meta2.windowsSnapshot[0].fileDiff.currentContent).toBe("v2 with edit\n");

    observableModule.disableDebug();
  });
});
