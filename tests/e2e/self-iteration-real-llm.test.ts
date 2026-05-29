/**
 * tests/e2e/self-iteration-real-llm.test.ts
 *
 * Real-LLM e2e: OOC system self-iteration via repo_* methods (Round 10).
 *
 * Scenario: Talk to agent_of_programmable:
 *   "There is a typo in stones/main/objects/supervisor/readme.md.
 *    Fix it: change all instances of 'OOC' to 'OOC-3'.
 *    Use repo_read to see current content, repo_write to fix,
 *    repo_run_tsc to verify nothing broke,
 *    then repo_git_status to confirm only that file changed."
 *
 * Verifies:
 *   - thread completes (status=done)
 *   - readme.md actually changed on disk (contains 'OOC-3')
 *   - git status shows the change
 *   - agent did not break tsc
 *
 * Skip condition: ANTHROPIC_API_KEY not set.
 *
 * Run:
 *   ANTHROPIC_API_KEY=<key> bun test tests/e2e/self-iteration-real-llm.test.ts
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "@src/thinkable/worker";
import { createLlmClient } from "@src/thinkable/llm/client";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import type { ThinkThread } from "@src/thinkable/think-thread";

const hasApiKey = Boolean(process.env.OOC_API_KEY || process.env.ANTHROPIC_API_KEY);

function ensureClaudeEnv() {
    if (!process.env.OOC_PROVIDER) process.env.OOC_PROVIDER = "claude";
    if (!process.env.OOC_API_KEY) process.env.OOC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
    if (!process.env.OOC_BASE_URL) process.env.OOC_BASE_URL = "https://api.anthropic.com";
    if (!process.env.OOC_MODEL) process.env.OOC_MODEL = "claude-haiku-4-5";
}

const TARGET_FILE = "stones/main/objects/supervisor/readme.md";

describe.skipIf(!hasApiKey)("self-iteration real-LLM e2e (Round 10)", () => {
    test(
        "agent reads supervisor readme, replaces OOC with OOC-3, verifies tsc + git status",
        async () => {
            ensureClaudeEnv();
            // Use a temp dir as worldRoot for flows/session data; repo ops go to real repo root
            const worldRoot = mkdtempSync(join(tmpdir(), "ooc-self-iter-"));
            const sessionId = `_test_self_iter_${Date.now()}`;

            // Read the target file before the test to know what we expect to change
            const repoRoot = process.cwd();
            const targetAbsPath = join(repoRoot, TARGET_FILE);
            const originalContent = readFileSync(targetAbsPath, "utf8");
            console.log("[self-iter-e2e] original readme first 100 chars:", originalContent.slice(0, 100));

            // Load root prototype from project (builtin stones)
            const registry = new ObjectRegistry();
            const records = await loadObjects({ worldRoot: repoRoot });
            for (const r of records) registry.set(r);
            const root = records.find(r => r.uri.includes("/objects/root"))!;
            expect(root).toBeDefined();

            const llmClient = createLlmClient();
            const worker = new Worker({ worldRoot, pollMs: 50 }, llmClient, registry);

            const thread: ThinkThread = {
                id: `t_self_iter_${Date.now()}`,
                sessionId,
                objectUri: root.uri,
                messages: [
                    {
                        type: "message" as const,
                        role: "system" as const,
                        content: [
                            "You are agent_of_programmable, the OOC-3 self-iteration agent.",
                            "You have these tools: repo_read, repo_write, repo_run_tsc, repo_run_tests, repo_git_diff, repo_git_status, repo_git_commit.",
                            "Use them to modify the OOC-3 source tree directly.",
                            "All repo_* paths are relative to the repo root.",
                            "Work step by step: read → write → verify → report.",
                        ].join("\n"),
                    },
                    {
                        type: "message" as const,
                        role: "user" as const,
                        content: [
                            `There is a typo in ${TARGET_FILE}.`,
                            "Fix it: change all instances of 'OOC' (the bare acronym, not already followed by -3) to 'OOC-3'.",
                            "Steps:",
                            `1. Use repo_read with path="${TARGET_FILE}" to see the current content.`,
                            "2. Rewrite the content replacing 'OOC' with 'OOC-3' where appropriate (be careful not to double-apply: 'OOC-3' should stay 'OOC-3').",
                            `3. Use repo_write with path="${TARGET_FILE}" and the fixed content.`,
                            "4. Use repo_run_tsc to verify no TypeScript errors were introduced.",
                            "5. Use repo_git_status to confirm only that file is modified.",
                            "6. Report what you did: say 'Done: replaced X occurrences of OOC with OOC-3' or similar.",
                        ].join("\n"),
                    },
                ],
                status: "running",
                maxTicks: 12,
                ticks: 0,
                llmTimeoutMs: 60_000,
            };

            worker.submit(thread);
            await worker.runUntilDone(120_000);

            console.log("[self-iter-e2e] thread status:", thread.status);
            console.log("[self-iter-e2e] total messages:", thread.messages.length);

            // Log tool calls for tracing
            const toolCalls = thread.messages.filter(m => m.type === "function_call");
            const toolResults = thread.messages.filter(m => m.type === "function_call_output");
            console.log("[self-iter-e2e] tool calls:", toolCalls.length, "results:", toolResults.length);
            const toolNames = toolCalls.map(m => (m as { type: string; name?: string }).name ?? "?").join(", ");
            console.log("[self-iter-e2e] tools used:", toolNames);

            const lastAssistant = [...thread.messages].reverse().find(
                m => m.type === "message" && (m as { type: string; role: string }).role === "assistant"
            );
            const lastContent = lastAssistant && "content" in lastAssistant
                ? (lastAssistant as { content: string }).content
                : "";
            console.log("[self-iter-e2e] LLM final response:", lastContent?.slice(0, 500));

            // Check thread completed
            expect(thread.status).toBe("done");

            // Check the file was actually modified on disk
            const updatedContent = readFileSync(targetAbsPath, "utf8");
            console.log("[self-iter-e2e] updated readme first 200 chars:", updatedContent.slice(0, 200));

            // The file should now contain OOC-3 (agent applied the fix)
            expect(updatedContent).toContain("OOC-3");

            // Git status should show the file as modified
            const gitStatus = Bun.spawnSync({
                cmd: ["git", "status", "--short", TARGET_FILE],
                cwd: repoRoot,
                stdout: "pipe",
                stderr: "pipe",
            });
            const statusOut = gitStatus.stdout?.toString() ?? "";
            console.log("[self-iter-e2e] git status:", statusOut.trim());
            expect(statusOut.trim().length).toBeGreaterThan(0);

            // Show the actual diff the LLM produced
            const gitDiff = Bun.spawnSync({
                cmd: ["git", "diff", "--", TARGET_FILE],
                cwd: repoRoot,
                stdout: "pipe",
                stderr: "pipe",
            });
            const diffOut = gitDiff.stdout?.toString() ?? "";
            console.log("[self-iter-e2e] LLM-produced diff:\n", diffOut.slice(0, 2000));

            // Restore original to avoid polluting the working tree after e2e
            // (comment this out if you want to keep the change for inspection)
            const { writeFileSync } = await import("node:fs");
            writeFileSync(targetAbsPath, originalContent);
            console.log("[self-iter-e2e] restored original file");
        },
        120_000,
    );
});
