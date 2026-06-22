import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureStoneRepo,
  createStoneObject,
  createObjectInSession,
  resolveStoneIdentityRef,
  stoneDir,
} from "@ooc/core/persistable";
import { writeSelf, readSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import { Class as ThreadClass } from "@ooc/builtins/agent/thread";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";

/** talk constructor 现寄居在 thread Class.construct（target=别对象 ⇒ peer 会话校验存在性）。 */
const talkConstructor = ThreadClass.construct!;

/**
 * Session-aware 读路径回归（真victim 调用点 G1 talk + identity）。
 *
 * 根因：session 内 create_object 落 `flows/<sid>/objects/<id>/`（worktree，未合 main），
 * 但运行时**读点**硬读 `stones/main`，导致同 session 内 talk/identity 找不到新对象。
 * chokepoint `resolveStoneIdentityRef` 本身已正确——bug 在 victim 调用点不经它。
 * 本测试驱动真实 victim（talk constructor exec），断言：session 内通、main/别 session 隔离。
 */

function commitMain(baseDir: string): void {
  const mainDir = join(baseDir, "stones", "main");
  Bun.spawnSync(["git", "add", "-A"], { cwd: mainDir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@ooc.local", "commit", "-m", "seed"],
    { cwd: mainDir, stdout: "pipe", stderr: "pipe" },
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 造一个最小 ThreadContext，仅含 talk constructor 需要的 persistence。 */
function mkThread(baseDir: string, sessionId: string, objectId: string): ThreadContext {
  return {
    id: "t_test",
    status: "running",
    events: [],
    contextWindows: [],
    persistence: { baseDir, sessionId, objectId, threadId: "t_test" },
  };
}

/**
 * 驱动真实 talk constructor exec（Wave4：ObjectConstructor.exec(ctx, args) → Data，
 * peer target 不存在时 throw）。返回是否解析成功（throw ⇒ target 不存在）。
 */
async function talkResolves(thread: ThreadContext, target: string): Promise<boolean> {
  const args = { target, title: "hi" };
  try {
    await talkConstructor.exec({ persistence: thread.persistence, args }, args);
    return true;
  } catch {
    return false;
  }
}

describe("session-aware read chokepoint (victim call sites)", () => {
  test("session 内 create_object → 同 session talk/identity 读得到；main/别 session 读不到", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-sar-"));
    try {
      // 1) seed main：建 supervisor 并 commit 进 main HEAD（继承底座）
      await ensureStoneRepo({ baseDir });
      await createStoneObject({ baseDir, objectId: "supervisor", _stonesBranch: "main" });
      await writeSelf({ baseDir, objectId: "supervisor", _stonesBranch: "main" }, "# Supervisor\n");
      commitMain(baseDir);

      const sid = "_test_pa_sess";
      const otherSid = "_test_pa_other";
      const newId = "_test_obj";

      // 2) 在 business session <sid> 建新对象（落 flows/<sid>/objects/<newId>，未合 main）
      const created = await createObjectInSession({
        baseDir,
        sessionId: sid,
        authorObjectId: "supervisor",
        newObjectId: newId,
        selfMd: "# Test Obj\n本对象只活在 session worktree。\n",
        readableMd: "---\ntitle: Test Obj\n---\n对外可见说明。\n",
      });
      expect(created.ok).toBe(true);

      // 物理落点：worktree 有 newId，main 没有
      expect(await pathExists(join(baseDir, "flows", sid, "objects", newId, "self.md"))).toBe(true);
      expect(await pathExists(join(baseDir, "stones", "main", "objects", newId))).toBe(false);

      // ── G1：session 上下文下 talk target 解析得到新对象 ────────────────
      expect(await talkResolves(mkThread(baseDir, sid, "supervisor"), newId)).toBe(true);

      // ── identity：session-aware ref 读到 worktree self.md（基线断言 chokepoint 仍真）──
      const sessionRef = await resolveStoneIdentityRef({ baseDir, sessionId: sid, objectId: newId }, "read");
      expect(sessionRef._stonesBranch).toBe(`session-${sid}`);
      expect(await readSelf(sessionRef)).toContain("本对象只活在 session worktree");
      // main-canonical 既有对象在 session 上下文仍读得到（worktree 是 main 完整副本）
      const supSessionRef = await resolveStoneIdentityRef({ baseDir, sessionId: sid, objectId: "supervisor" }, "read");
      expect(await readSelf(supSessionRef)).toContain("# Supervisor");

      // ── main 上下文：talk 读不到（无 session → 读 canonical main，行为不变）──
      // talk constructor 缺 sessionId 时落 main → 找不到 → ok:false
      const mainThread = mkThread(baseDir, "", "supervisor");
      expect(await talkResolves(mainThread, newId)).toBe(false);
      expect(await readSelf({ baseDir, objectId: newId })).toBeUndefined();

      // ── 跨 session 隔离：session B 看不到 session A 未合入对象 ────────────
      expect(await talkResolves(mkThread(baseDir, otherSid, "supervisor"), newId)).toBe(false);
      const otherRef = await resolveStoneIdentityRef({ baseDir, sessionId: otherSid, objectId: newId }, "read");
      expect(otherRef._stonesBranch).toBeUndefined();
      expect(await readSelf(otherRef)).toBeUndefined();

      // ── main-canonical supervisor 在所有上下文仍可被 peer talk（不回归既有 main 读）──
      // 注：peer 形态 = caller 与 target 不同对象（talk(target=自己) 现在是 fork，不再走 peer 存在性检查）。
      expect(await talkResolves(mkThread(baseDir, sid, "user"), "supervisor")).toBe(true);
      expect(await talkResolves(mkThread(baseDir, "", "user"), "supervisor")).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
