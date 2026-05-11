import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStonesService } from "./service";

describe("stones service", () => {
  test("creates stone and reads/writes self", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-stones-"));

    try {
      const service = createStonesService({ baseDir });
      await service.createStone({ objectId: "agent" });
      await service.putSelf({ objectId: "agent", text: "# agent" });
      const result = await service.getSelf({ objectId: "agent" });
      expect(result.text).toContain("agent");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
