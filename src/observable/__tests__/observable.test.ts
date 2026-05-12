import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import * as observableModule from "../index";
import type { ThreadContext } from "../../thinkable/context";
import type { LlmGenerateResult, LlmInputItem, LlmTool } from "../../thinkable/llm/types";
import {
  createFlowObject,
  llmInputFile,
  llmOutputFile,
  loopMetaFile,
  loopInputFile,
  loopOutputFile
} from "../../persistable";

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
      events: []
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
      events: []
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
  });
});
