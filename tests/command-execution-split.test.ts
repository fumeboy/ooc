import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("command execution split", () => {
  test("each openable command module exports its execute function", async () => {
    const modules = {
      await: await import("../src/executable/commands/await.js"),
      await_all: await import("../src/executable/commands/await_all.js"),
      compact: await import("../src/executable/commands/compact.js"),
      defer: await import("../src/executable/commands/defer.js"),
      program: await import("../src/executable/commands/program.js"),
      return: await import("../src/executable/commands/return.js"),
      set_plan: await import("../src/executable/commands/set_plan.js"),
      talk: await import("../src/executable/commands/talk.js"),
      think: await import("../src/executable/commands/think.js"),
    };

    expect(typeof modules.await.executeAwaitCommand).toBe("function");
    expect(typeof modules.await_all.executeAwaitAllCommand).toBe("function");
    expect(typeof modules.compact.executeCompactCommand).toBe("function");
    expect(typeof modules.defer.executeDeferCommand).toBe("function");
    expect(typeof modules.program.executeProgramCommand).toBe("function");
    expect(typeof modules.return.executeReturnCommand).toBe("function");
    expect(typeof modules.set_plan.executeSetPlanCommand).toBe("function");
    expect(typeof modules.talk.executeTalkCommand).toBe("function");
    expect(typeof modules.think.executeThinkCommand).toBe("function");
  });

  test("engine delegates command execution instead of branching per command", () => {
    const engine = readFileSync(join(import.meta.dir, "../src/thinkable/engine/engine.ts"), "utf-8");
    for (const command of ["program", "talk", "return", "think", "set_plan", "await", "await_all", "compact", "defer"]) {
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
