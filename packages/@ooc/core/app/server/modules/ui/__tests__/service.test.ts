import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUiService } from "../service";

describe("ui service · listFlows", () => {
  test("returns sorted directory names under <baseDir>/flows/", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-ui-listflows-"));
    try {
      const flowsDir = join(baseDir, "flows");
      await mkdir(flowsDir, { recursive: true });
      await mkdir(join(flowsDir, "session-b"));
      await mkdir(join(flowsDir, "session-a"));
      await mkdir(join(flowsDir, ".hidden"));
      // 文件不应进入列表
      await writeFile(join(flowsDir, "stray.json"), "{}");

      const service = createUiService({ baseDir });
      const out = await service.listFlows();
      expect(out).toEqual({ flows: ["session-a", "session-b"] });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("returns empty list when flows/ does not exist", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-ui-listflows-empty-"));
    try {
      const service = createUiService({ baseDir });
      const out = await service.listFlows();
      expect(out).toEqual({ flows: [] });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("returns empty list when flows/ exists but is empty", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-ui-listflows-bare-"));
    try {
      await mkdir(join(baseDir, "flows"));
      const service = createUiService({ baseDir });
      const out = await service.listFlows();
      expect(out).toEqual({ flows: [] });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
