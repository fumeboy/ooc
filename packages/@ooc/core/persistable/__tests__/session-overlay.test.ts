import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  OVERLAY_SUBDIR,
  overlayStoneFilePath,
  sessionUsesOverlay,
  relWithinObjectFromPackages,
  readOverlayFile,
  writeOverlayFile,
  readStoneFileWithOverlay,
} from "../session-overlay";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("overlayStoneFilePath", () => {
  test("flat objectId → flows/<sid>/<id>/overlay/<rel>", () => {
    const p = overlayStoneFilePath("/w", "sess1", "alice", "self.md");
    expect(p).toBe(join("/w", "flows", "sess1", "alice", OVERLAY_SUBDIR, "self.md"));
  });

  test("nested objectId uses children/ marker", () => {
    const p = overlayStoneFilePath("/w", "s", "a/b", "executable/index.ts");
    expect(p).toBe(
      join("/w", "flows", "s", "a", "children", "b", OVERLAY_SUBDIR, "executable", "index.ts"),
    );
  });
});

describe("sessionUsesOverlay", () => {
  test("normal business session → true", () => {
    expect(sessionUsesOverlay("sess1")).toBe(true);
  });
  test("super flow → false", () => {
    expect(sessionUsesOverlay("super")).toBe(false);
    expect(sessionUsesOverlay("SUPER")).toBe(false);
  });
  test("undefined (memory / control plane) → false", () => {
    expect(sessionUsesOverlay(undefined)).toBe(false);
  });
});

describe("relWithinObjectFromPackages", () => {
  test("flat owner: strips owner prefix", () => {
    expect(relWithinObjectFromPackages("alice", "alice/self.md")).toBe("self.md");
    expect(relWithinObjectFromPackages("alice", "alice/executable/index.ts")).toBe(
      "executable/index.ts",
    );
  });
  test("nested owner: strips children/-encoded prefix", () => {
    expect(relWithinObjectFromPackages("a/b", "a/children/b/self.md")).toBe("self.md");
  });
  test("mismatched prefix → undefined (defensive)", () => {
    expect(relWithinObjectFromPackages("alice", "bob/self.md")).toBeUndefined();
  });
});

describe("overlay read/write round trip", () => {
  test("write then read overlay", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-overlay-"));
    await writeOverlayFile(tempRoot, "sess1", "alice", "self.md", "# experimental self");
    expect(await readOverlayFile(tempRoot, "sess1", "alice", "self.md")).toBe(
      "# experimental self",
    );
    // physical落点正确
    const onDisk = await readFile(
      join(tempRoot, "flows", "sess1", "alice", OVERLAY_SUBDIR, "self.md"),
      "utf8",
    );
    expect(onDisk).toBe("# experimental self");
  });

  test("read missing overlay → undefined", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-overlay-"));
    expect(await readOverlayFile(tempRoot, "sess1", "alice", "self.md")).toBeUndefined();
  });
});

describe("readStoneFileWithOverlay — shadow semantics", () => {
  test("business session with overlay → reads overlay (shadow main)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-overlay-"));
    await writeOverlayFile(tempRoot, "sess1", "alice", "self.md", "OVERLAY");
    const got = await readStoneFileWithOverlay(
      tempRoot,
      "sess1",
      "alice",
      "self.md",
      async () => "CANONICAL",
    );
    expect(got).toBe("OVERLAY");
  });

  test("business session without overlay → falls through to canonical", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-overlay-"));
    const got = await readStoneFileWithOverlay(
      tempRoot,
      "sess1",
      "alice",
      "self.md",
      async () => "CANONICAL",
    );
    expect(got).toBe("CANONICAL");
  });

  test("super flow → ignores overlay, reads canonical even if overlay file exists", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-overlay-"));
    // 即便 super session 目录下放了 overlay，super 不 shadow（它操作 canonical 本身）
    await writeOverlayFile(tempRoot, "super", "alice", "self.md", "OVERLAY");
    const got = await readStoneFileWithOverlay(
      tempRoot,
      "super",
      "alice",
      "self.md",
      async () => "CANONICAL",
    );
    expect(got).toBe("CANONICAL");
  });

  test("different session reads its own (absent) overlay → canonical main", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-overlay-"));
    await writeOverlayFile(tempRoot, "sess1", "alice", "self.md", "SESS1-ONLY");
    // sess2 没有 overlay → 读 main
    const got = await readStoneFileWithOverlay(
      tempRoot,
      "sess2",
      "alice",
      "self.md",
      async () => "CANONICAL",
    );
    expect(got).toBe("CANONICAL");
    // sess1 仍读自己的 overlay
    const got1 = await readStoneFileWithOverlay(
      tempRoot,
      "sess1",
      "alice",
      "self.md",
      async () => "CANONICAL",
    );
    expect(got1).toBe("SESS1-ONLY");
  });
});
