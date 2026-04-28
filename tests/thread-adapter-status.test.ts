import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { threadsToProcess } from "../src/storable/thread/thread-adapter.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ooc-thread-adapter-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("threadsToProcess status mapping", () => {
  test("waiting thread maps to waiting process node and keeps raw thread status", () => {
    mkdirSync(join(dir, "threads", "root"), { recursive: true });
    writeFileSync(join(dir, "threads.json"), JSON.stringify({
      rootId: "root",
      nodes: {
        root: {
          id: "root",
          title: "root",
          status: "waiting",
          waitingType: "explicit_wait",
          childrenIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    }, null, 2));
    writeFileSync(join(dir, "threads", "root", "thread.json"), JSON.stringify({ id: "root", events: [] }, null, 2));

    const process = threadsToProcess(dir);

    expect(process?.root.status).toBe("waiting");
    expect((process?.root.locals as any)._threadStatus).toBe("waiting");
  });
});
