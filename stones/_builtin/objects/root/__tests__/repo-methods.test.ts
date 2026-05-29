/**
 * stones/_builtin/objects/root/__tests__/repo-methods.test.ts
 *
 * Unit tests for repo_* methods (Round 10: self-iteration capability).
 *
 * Tests repo_read, repo_write (including audit log), repo_run_tsc,
 * repo_git_status, and path-safety guards.
 *
 * repo_run_tests is intentionally skipped here (too slow for CI; covered in e2e).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root repo_* methods (Round 10)", () => {
    let world: string;

    function makeCtx(sessionId = "s_repo_test"): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: "ooc://stones/main/objects/agent_of_programmable",
            paths: { stone: path.join(process.cwd(), "stones", "main", "objects", "agent_of_programmable") },
            kind: "persistent",
            self: {},
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId, registry: reg };
    }

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-repo-methods-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    /* ---- repo_read ---- */

    test("repo_read reads a real repo file (package.json)", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.repo_read!({ path: "package.json" } as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(typeof r.content).toBe("string");
        expect(r.content).toContain("\"name\"");
        expect(r.bytes).toBeGreaterThan(0);
    });

    test("repo_read resolves absolute path inside repo root", async () => {
        const ctx = makeCtx();
        const absPath = path.join(process.cwd(), "package.json");
        const r = (await rootServer.public.repo_read!({ path: absPath } as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(r.content).toContain("\"name\"");
    });

    test("repo_read rejects path outside repo root via relative escape", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.repo_read!({ path: "../../etc/passwd" } as any, ctx),
        ).rejects.toThrow(/outside repo root/);
    });

    test("repo_read rejects absolute path outside repo root", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.repo_read!({ path: "/etc/hosts" } as any, ctx),
        ).rejects.toThrow(/outside repo root/);
    });

    test("repo_read throws on missing path arg", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.repo_read!({} as any, ctx),
        ).rejects.toThrow(/path.*required/i);
    });

    /* ---- repo_read: lines parameter (partial reads) ---- */

    test("repo_read with lines=[start,end] returns the correct slice and lines_total", async () => {
        const ctx = makeCtx();
        // Read the full file first to know what to expect.
        const full = (await rootServer.public.repo_read!({ path: "package.json" } as any, ctx)) as any;
        const allLines = (full.content as string).split("\n");
        const total = allLines.length;
        // Pick a small range that exists.
        const start = 1;
        const end = Math.min(3, total);
        const expectedSlice = allLines.slice(start - 1, end).join("\n");

        const r = (await rootServer.public.repo_read!(
            { path: "package.json", lines: [start, end] } as any,
            ctx,
        )) as any;
        expect(r.ok).toBe(true);
        expect(r.content).toBe(expectedSlice);
        expect(r.lines).toEqual([start, end]);
        expect(r.lines_total).toBe(total);
    });

    test("repo_read with out-of-range lines clamps silently", async () => {
        const ctx = makeCtx();
        const full = (await rootServer.public.repo_read!({ path: "package.json" } as any, ctx)) as any;
        const allLines = (full.content as string).split("\n");
        const total = allLines.length;

        // Way past end: both start and end should clamp to `total`.
        const r = (await rootServer.public.repo_read!(
            { path: "package.json", lines: [total + 100, total + 500] } as any,
            ctx,
        )) as any;
        expect(r.ok).toBe(true);
        expect(r.lines).toEqual([total, total]);
        expect(r.lines_total).toBe(total);
        // Should equal the last single line (slice of [total-1, total]).
        expect(r.content).toBe(allLines[total - 1]);

        // Negative start should clamp up to 1.
        const r2 = (await rootServer.public.repo_read!(
            { path: "package.json", lines: [-10, 2] } as any,
            ctx,
        )) as any;
        expect(r2.ok).toBe(true);
        expect(r2.lines).toEqual([1, Math.min(2, total)]);
    });

    test("repo_read lines_total equals total line count of the file (no lines arg)", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.repo_read!({ path: "package.json" } as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(typeof r.lines_total).toBe("number");
        // Cross-check: split content ourselves and compare.
        const expectedTotal = (r.content as string).split("\n").length;
        expect(r.lines_total).toBe(expectedTotal);
    });

    /* ---- repo_write ---- */

    test("repo_write creates a file in the repo and audit-logs it", async () => {
        const ctx = makeCtx("s_audit_test");
        // Write to a temp sub-path within the real repo root (use a .gitignore-safe location)
        // We'll write to a temp path that IS under the repo root but is cleaned after test.
        // Use the real process.cwd() which IS the repo root in the test runner.
        const repoRoot = process.cwd();
        const tempFile = path.join(repoRoot, ".ooc-world", "test-repo-write-tmp.txt");
        const r = (await rootServer.public.repo_write!({ path: tempFile, content: "hello repo" } as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(r.bytes).toBe(10);

        // Verify file content
        const content = await fs.readFile(tempFile, "utf8");
        expect(content).toBe("hello repo");

        // Verify audit log exists
        const auditPath = path.join(world, "flows", "s_audit_test", "objects", "agent_of_programmable", "repo-writes.jsonl");
        const auditContent = await fs.readFile(auditPath, "utf8");
        const entry = JSON.parse(auditContent.trim());
        expect(entry.path).toBe(tempFile);
        expect(entry.bytes).toBe(10);
        expect(typeof entry.ts).toBe("string");

        // Cleanup
        await fs.unlink(tempFile).catch(() => {});
    });

    test("repo_write rejects path outside repo root", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.repo_write!({ path: "/tmp/evil.txt", content: "x" } as any, ctx),
        ).rejects.toThrow(/outside repo root/);
    });

    test("repo_write rejects relative escape path", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.repo_write!({ path: "../../evil.txt", content: "x" } as any, ctx),
        ).rejects.toThrow(/outside repo root/);
    });

    /* ---- repo_run_tsc ---- */

    test("repo_run_tsc returns 0 errors on clean tree", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.repo_run_tsc!({} as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(r.exit_code).toBe(0);
        expect(r.errors_count).toBe(0);
    }, 90_000);

    /* ---- repo_git_status ---- */

    test("repo_git_status returns short status string", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.repo_git_status!({} as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(typeof r.status).toBe("string");
        // status is either empty (clean) or has lines like "M src/..."
    });

    /* ---- repo_git_diff ---- */

    test("repo_git_diff returns diff string", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.repo_git_diff!({} as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(typeof r.diff).toBe("string");
    });

    /* ---- repo_git_commit path safety ---- */

    test("repo_git_diff rejects path outside repo root", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.repo_git_diff!({ path: "../../outside" } as any, ctx),
        ).rejects.toThrow(/outside repo root/);
    });

    /* ---- repo_search ---- */

    test("repo_search finds matches in real repo files", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.repo_search!(
            { pattern: "async repo_read", max_results: 5 } as any,
            ctx,
        )) as any;
        expect(r.ok).toBe(true);
        expect(Array.isArray(r.matches)).toBe(true);
        expect(r.matches.length).toBeGreaterThan(0);
        expect(r.matches.length).toBeLessThanOrEqual(5);
        // Each match has file/line/content shape; line is 1-indexed positive int.
        for (const m of r.matches) {
            expect(typeof m.file).toBe("string");
            expect(typeof m.line).toBe("number");
            expect(m.line).toBeGreaterThan(0);
            expect(typeof m.content).toBe("string");
            expect(m.content).toMatch(/async repo_read/);
        }
        // The root server file should be among the matches.
        const files = r.matches.map((m: any) => m.file);
        expect(files.some((f: string) => f.includes("stones/_builtin/objects/root/server/index.ts"))).toBe(true);
        expect(typeof r.total).toBe("number");
        expect(r.total).toBeGreaterThanOrEqual(r.matches.length);
    }, 30_000);

    test("repo_search respects max_results cap and skips ignored dirs", async () => {
        const ctx = makeCtx();
        // A common token; cap to 3 to verify the cap.
        const r = (await rootServer.public.repo_search!(
            { pattern: "export", max_results: 3 } as any,
            ctx,
        )) as any;
        expect(r.ok).toBe(true);
        expect(r.matches.length).toBeLessThanOrEqual(3);
        // No match should come from skipped directories.
        for (const m of r.matches) {
            expect(m.file.startsWith("node_modules/")).toBe(false);
            expect(m.file.startsWith(".git/")).toBe(false);
            expect(m.file.startsWith("dist/")).toBe(false);
            expect(m.file.startsWith(".ooc-world/")).toBe(false);
        }
    }, 30_000);

    test("repo_search rejects missing pattern and path-escape", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.repo_search!({} as any, ctx),
        ).rejects.toThrow(/pattern.*required/i);
        await expect(
            rootServer.public.repo_search!({ pattern: "x", path: "../../etc" } as any, ctx),
        ).rejects.toThrow(/outside repo root/);
    });
});
