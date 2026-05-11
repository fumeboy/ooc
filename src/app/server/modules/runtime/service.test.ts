import { describe, expect, test } from "bun:test";
import { createJobManager } from "../../runtime/job-manager";
import { createPauseStore } from "../../runtime/pause-store";
import { createRuntimeService } from "./service";

describe("runtime service", () => {
  test("returns global pause status", () => {
    const pauseStore = createPauseStore();
    const service = createRuntimeService({
      pauseStore,
      jobManager: createJobManager(),
    });

    pauseStore.enableGlobalPause();

    expect(service.getGlobalPauseStatus()).toEqual({ enabled: true });
  });
});
