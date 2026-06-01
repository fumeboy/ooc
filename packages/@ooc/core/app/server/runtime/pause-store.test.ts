import { describe, expect, test } from "bun:test";
import { createPauseStore, type PauseStore } from "./pause-store";

describe("pause-store", () => {
  test("tracks global and session pause state", () => {
    const store: PauseStore = createPauseStore();

    expect(store.isGlobalPauseEnabled()).toBe(false);
    expect(store.isSessionPaused("s1")).toBe(false);

    store.enableGlobalPause();
    store.pauseSession("s1");

    expect(store.isGlobalPauseEnabled()).toBe(true);
    expect(store.isSessionPaused("s1")).toBe(true);
  });
});
