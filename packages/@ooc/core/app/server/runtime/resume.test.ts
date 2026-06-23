import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject } from "@ooc/core/persistable";
import { llmOutputFile } from "@ooc/core/observable/debug-file";
import { writeThread } from "@ooc/core/persistable/thread-container-io.js";
import { resumePausedThread } from "./resume";

describe("resumePausedThread", () => {
  test("replays saved llm output instead of calling llm again", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-resume-"));

    try {
      const flowRef = await createFlowObject({ baseDir, sessionId: "s1", objectId: "agent" });
      const persistence = { ...flowRef, threadId: "root" } as const;

      await writeThread({
        id: "root",
        status: "paused",
        events: [],
      contextWindows: [],
        persistence,
      });

      await Bun.write(
        llmOutputFile(persistence),
        JSON.stringify(
          {
            threadId: "root",
            result: {
              provider: "openai",
              model: "test-model",
              text: "resume",
              thinking: "",
              toolCalls: [],
            },
          },
          null,
          2
        )
      );

      const thread = await resumePausedThread(persistence);

      expect(thread.status).toBe("running");
      expect(thread.events.some((event) => event.category === "llm_interaction" && event.kind === "text")).toBe(
        true
      );
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
