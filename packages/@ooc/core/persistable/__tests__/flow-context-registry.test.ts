import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  contextRegistryFile,
  readContextRegistry,
  writeContextRegistry,
  EMPTY_REGISTRY,
  type ContextRegistry,
} from "../flow-context-registry";
import { __resetSerialQueueForTests } from "@ooc/core/runtime/serial-queue";
import type { ThreadPersistenceRef } from "../common";

describe("flow-context-registry — ooc-6 P5'.1 thread context.json", () => {
  let baseDir: string;
  let tref: ThreadPersistenceRef;

  beforeEach(async () => {
    __resetSerialQueueForTests();
    baseDir = await mkdtemp(join(tmpdir(), "ooc-ctx-reg-"));
    tref = {
      baseDir,
      sessionId: "sess_reg",
      objectId: "agent_of_x",
      threadId: "t_001",
    };
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("computes registry path = <threadDir>/context.json", () => {
    expect(contextRegistryFile(tref)).toBe(
      join(baseDir, "flows", "sess_reg", "agent_of_x", "threads", "t_001", "context.json"),
    );
  });

  it("read returns EMPTY_REGISTRY when file missing", async () => {
    const reg = await readContextRegistry(tref);
    expect(reg).toEqual(EMPTY_REGISTRY);
    expect(reg.version).toBe(1);
    expect(reg.members).toEqual([]);
  });

  it("write + read roundtrip preserves members and params", async () => {
    const reg: ContextRegistry = {
      version: 1,
      members: [
        {
          objectId: "todo_a",
          params: { compressLevel: 0, order: 0 },
        },
        {
          objectId: "file_b",
          params: {
            compressLevel: 1,
            order: 1,
            decayMeta: { lastTouchedAt: 1717000000000, idleRounds: 3 },
            parentObjectId: "todo_a",
          },
        },
      ],
    };
    await writeContextRegistry(tref, reg);
    const back = await readContextRegistry(tref);
    expect(back).toEqual(reg);
  });

  it("rejects unsupported version", async () => {
    const file = contextRegistryFile(tref);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ version: 99, members: [] }) + "\n",
      "utf8",
    );
    await expect(readContextRegistry(tref)).rejects.toThrow(/unsupported version/);
  });

  it("creates parent thread dir if missing", async () => {
    const reg: ContextRegistry = { version: 1, members: [] };
    await writeContextRegistry(tref, reg);
    const file = contextRegistryFile(tref);
    const raw = await readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual(reg);
  });

  it("subsequent writes overwrite previous content (full registry write)", async () => {
    await writeContextRegistry(tref, {
      version: 1,
      members: [{ objectId: "x", params: { order: 0 } }],
    });
    await writeContextRegistry(tref, {
      version: 1,
      members: [
        { objectId: "y", params: { order: 0 } },
        { objectId: "z", params: { order: 1 } },
      ],
    });
    const back = await readContextRegistry(tref);
    expect(back.members.map((m) => m.objectId)).toEqual(["y", "z"]);
  });
});
