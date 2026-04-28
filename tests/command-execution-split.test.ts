import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("command execution split", () => {
  test("each openable command module exports its execute function", async () => {
    const modules = {
      compact: await import("../src/executable/commands/compact.js"),
      defer: await import("../src/executable/commands/defer.js"),
      program: await import("../src/executable/commands/program.js"),
      return: await import("../src/executable/commands/return.js"),
      plan: await import("../src/executable/commands/plan.js"),
      talk: await import("../src/executable/commands/talk.js"),
      do: await import("../src/executable/commands/do.js"),
    };

    expect(typeof modules.compact.executeCompactCommand).toBe("function");
    expect(typeof modules.defer.executeDeferCommand).toBe("function");
    expect(typeof modules.program.executeProgramCommand).toBe("function");
    expect(typeof modules.return.executeReturnCommand).toBe("function");
    expect(typeof modules.plan.executePlanCommand).toBe("function");
    expect(typeof modules.talk.executeTalkCommand).toBe("function");
    expect(typeof modules.do.executeDoCommand).toBe("function");
  });

  test("engine delegates command execution instead of branching per command", () => {
    const engine = readFileSync(join(import.meta.dir, "../src/thinkable/engine/engine.ts"), "utf-8");
    for (const command of ["program", "talk", "return", "do", "plan", "compact", "defer"]) {
      expect(engine).not.toContain(`command === "${command}"`);
    }
    expect(engine).toContain("executeCommand(");
  });

  test("engine keeps context rendering and flow data projection in focused modules", () => {
    const engine = readFileSync(join(import.meta.dir, "../src/thinkable/engine/engine.ts"), "utf-8");

    expect(engine).not.toContain("export function contextToMessages");
    expect(engine).not.toContain("export function writeThreadTreeFlowData");
    expect(engine).not.toContain("export async function runSuperThread");
    expect(engine.split("\n").length).toBeLessThan(2550);
  });
});
