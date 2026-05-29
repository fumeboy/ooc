#!/usr/bin/env bun
/**
 * OOC-3 server entry point.
 *
 * Usage: bun src/app/server/index.ts --world ./.ooc-world [--port 3000] [--stones-branch main]
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readServerConfig } from "./bootstrap/config";
import { runBootstrapSeeds } from "./bootstrap/seeds";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import { Worker } from "@src/thinkable/worker";
import { createLlmClient } from "@src/thinkable/llm/client";
import { startHttpServer } from "./http";

async function main(): Promise<void> {
    const config = await readServerConfig();

    const worldRoot = config.baseDir;
    const branch = config.stonesBranch;
    const port = config.port;

    console.log(`[ooc-3] worldRoot=${worldRoot} port=${port} branch=${branch}`);

    // 1. Ensure world directory structure exists
    await mkdir(resolve(worldRoot, "stones", branch, "objects"), { recursive: true });
    await mkdir(resolve(worldRoot, "flows"), { recursive: true });
    await mkdir(resolve(worldRoot, "pools", "objects"), { recursive: true });

    // 2. Seed supervisor + user stones (idempotent)
    const seeds = await runBootstrapSeeds(worldRoot, branch);
    if (seeds.supervisor.created) console.log("[ooc-3] seeded supervisor stone");
    if (seeds.user.created) console.log("[ooc-3] seeded user stone");

    // 3. Build registry: load builtin prototypes + source-tree branch stones + user world stones
    const registry = new ObjectRegistry();
    const cwd = process.cwd();

    // Load builtin prototypes from the source-tree stones/_builtin
    const builtinRecords = await loadObjects({ worldRoot: cwd });
    for (const r of builtinRecords) registry.set(r);

    // Load source-tree branch stones (the 9 AgentOfX seeded in repo's stones/main/objects/)
    // These are only in cwd, not in --world, so fresh worlds still see the full harness.
    const cwdBranchRecords = await loadObjects({ worldRoot: cwd, branch });
    for (const r of cwdBranchRecords) registry.set(r);

    // Load user persistent stones from --world (supervisor, user, any user-added).
    // User-defined stones override cwd defaults for the same URI (registry.set semantics).
    const persistentRecords = await loadObjects({ worldRoot, branch });
    for (const r of persistentRecords) registry.set(r);

    console.log(`[ooc-3] loaded ${registry.list().length} objects`);

    // 4. Build LLM client + Worker
    const llmClient = createLlmClient();
    const worker = new Worker(
        { worldRoot, pollMs: config.workerPollMs },
        llmClient,
        registry,
    );

    if (config.workerEnabled) {
        worker.start();
        console.log("[ooc-3] worker started");
    } else {
        console.log("[ooc-3] worker disabled (OOC_WORKER_ENABLED=0)");
    }

    // 5. Start HTTP server
    startHttpServer({ worker, registry, branch, sourceCwd: cwd }, port);
    console.log(`[ooc-3] server listening on http://localhost:${port}`);

    // Graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n[ooc-3] shutting down");
        worker.stop();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        console.log("\n[ooc-3] SIGTERM received, shutting down");
        worker.stop();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error("[ooc-3] fatal:", err);
    process.exit(1);
});
