import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveBuiltinDir } from "./builtin-dir";

describe("resolveBuiltinDir", () => {
  test("resolves supervisor builtin to the framework package dir (has self.md)", () => {
    const dir = resolveBuiltinDir("supervisor");
    expect(dir).toBeDefined();
    expect(existsSync(join(dir!, "self.md"))).toBe(true);
  });

  test("resolves _builtin/<id> prefixed ids too", () => {
    const dir = resolveBuiltinDir("_builtin/supervisor");
    expect(dir).toBeDefined();
    expect(existsSync(join(dir!, "self.md"))).toBe(true);
  });

  test("returns undefined for a non-builtin id", () => {
    expect(resolveBuiltinDir("some_user_stone")).toBeUndefined();
  });
});
