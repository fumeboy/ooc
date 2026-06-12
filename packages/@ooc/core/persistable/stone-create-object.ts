/**
 * createObjectInSession —— 在业务 session worktree 里原子地建**新对象骨架**
 * （package.json + self.md + readable.md [+ knowledge/]），落 `flows/<sid>/objects/<newId>/`。
 *
 * 背景：去 metaprog 后 supervisorCreateObject 被删，但 write_file 只能
 * 「改已存在对象的文件」——它靠 package.json 命中判 object 边界，新对象还没 package.json
 * → 被 classifyPackagesPath 判 workspace-level 资源拒写。于是「建新对象」这条原语断了。
 *
 * 本函数补回这条原语，但**落 session worktree（非旧的立即 commit main）**：
 * 复用 createStoneObject 建骨架（package.json + 空 self + 空 readable）→ writeSelf /
 * writeReadable 填内容 + 写 knowledge/<file>.md。**不 commit**。
 *
 * 地基不变量：session worktree 是纯运行时派生物，**永不合入 main**——
 * 新对象本 session 内即可用（session-aware 读已支持），进 canonical 走独立 feat-branch PR
 * （super flow new_feat_branch → 直接编辑 → create_pr_and_invite_reviewers）。本函数只负责落盘骨架到 worktree（fail-loud，不静默吞）。
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createStoneObject, stoneKnowledgeDir, stoneDir } from "./stone-object.js";
import { writeSelf } from "./stone-self.js";
import { writeReadable } from "./stone-readable.js";
import { resolveStoneIdentityRef, sessionUsesWorktree } from "./stone-worktree.js";
import { isBuiltinObjectId, type StoneObjectRef } from "./common.js";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";

/** 单段 objectId 合法字符（与 versioning.isValidObjectId 对齐：不含 `/`）。 */
const OBJECT_ID_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/**
 * 校验 objectId（含嵌套 child：`parent/child`、`a/b/c`）。
 *
 * 与 versioning.isValidObjectId 同款：整串 ≤ 64、逐段匹配 pattern、拒空段 / `.` / `..`
 * （防 path traversal）。至少 1 段。
 */
function isValidObjectId(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  const segments = value.split("/");
  if (segments.length === 0) return false;
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return false;
    if (!OBJECT_ID_SEGMENT_PATTERN.test(seg)) return false;
  }
  return true;
}

export interface CreateObjectInSessionInput {
  /** OOC world 根。 */
  baseDir: string;
  /** 建对象的业务 session（thread.persistence.sessionId）——必须是 business session（非 super / 非空）。 */
  sessionId: string;
  /** 发起者 objectId（事后审计；新对象 ≠ author 故沉淀 PR 时 reviewer 含新对象 owner）。 */
  authorObjectId: string;
  /** 新对象 id（不能是 Builtin、不能在 main 或当前 worktree 已存在）。 */
  newObjectId: string;
  /** 新对象 self.md 全文（非空）。 */
  selfMd: string;
  /** 新对象 readable.md 全文（非空）。 */
  readableMd: string;
  /** 可选 seed knowledge（filename → markdown content；写到 knowledge/）。 */
  knowledge?: Record<string, string>;
}

export type CreateObjectInSessionResult =
  | { ok: true; objectId: string; worktreePath: string }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "ALREADY_EXISTS"; message: string }
  | { ok: false; code: "BUILTIN_CONFLICT"; message: string }
  | { ok: false; code: "WORKTREE"; message: string };

/** 某 ref 指向的对象目录是否已含 package.json（= object 已存在的 marker）。 */
async function objectExists(ref: StoneObjectRef): Promise<boolean> {
  const marker = join(stoneDir(ref), "package.json");
  try {
    const st = await stat(marker);
    return st.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * 在业务 session worktree 里建新对象骨架（不 commit）。
 *
 * 流程：
 *   1. 校验 newObjectId 合法 / 非 Builtin / selfMd·readableMd 非空 / knowledge filename 安全。
 *   2. 校验 sessionId 是 business session（super / 无 session 不该走这里）。
 *   3. resolveStoneIdentityRef(write) 拿 session worktree ref（lazy 建 worktree）。
 *   4. 串行化下：对象在 main + 当前 worktree 都不存在（ALREADY_EXISTS）→ createStoneObject
 *      建骨架 → writeSelf / writeReadable 填内容 → 写 knowledge/<file>.md。
 *   5. 不 commit，返回 worktreePath。
 */
export async function createObjectInSession(
  input: CreateObjectInSessionInput,
): Promise<CreateObjectInSessionResult> {
  const { baseDir, sessionId, authorObjectId, newObjectId, selfMd, readableMd, knowledge } = input;

  if (!isValidObjectId(newObjectId)) {
    return { ok: false, code: "INVALID_INPUT", message: `非法 newObjectId '${newObjectId}'（≤64 字符、逐段 [A-Za-z0-9_.-]、不含空段/. /..）。` };
  }
  if (isBuiltinObjectId(newObjectId)) {
    return {
      ok: false,
      code: "BUILTIN_CONFLICT",
      message: `objectId '${newObjectId}' 与 Builtin Object（supervisor/user/root 等）冲突，不能建。`,
    };
  }
  if (typeof selfMd !== "string" || !selfMd.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "selfMd 必填（非空）。" };
  }
  if (typeof readableMd !== "string" || !readableMd.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "readableMd 必填（非空）。" };
  }
  if (knowledge) {
    for (const filename of Object.keys(knowledge)) {
      if (filename.includes("/") || filename.includes("..") || filename.startsWith(".")) {
        return { ok: false, code: "INVALID_INPUT", message: `非法 knowledge filename '${filename}'（禁含 '/'、'..'、前导 '.'）。` };
      }
    }
  }
  if (!sessionUsesWorktree(sessionId)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `建对象须在 business session（当前 session='${sessionId ?? ""}'，super / 无 session 不能建）。`,
    };
  }

  // 拿 session worktree ref（ensureSessionWorktree 会 lazy 建 worktree）。
  const wtRef = await resolveStoneIdentityRef({ baseDir, sessionId, objectId: newObjectId }, "write");
  if (wtRef._stonesBranch == null) {
    return {
      ok: false,
      code: "WORKTREE",
      message: `建 session '${sessionId}' 的 worktree 失败（ensureSessionWorktree 兜底回 main）——拒绝建对象（建对象必须落 worktree，不直写 main）。`,
    };
  }

  // 串行化（与其它 session worktree git/fs 写共用同一锁键），并在锁内做 existence check 防 race。
  return enqueueSessionWrite(`git:${baseDir}`, async () => {
    // main 已存在？（newId 不能撞 canonical 现有对象）
    if (await objectExists({ baseDir, objectId: newObjectId })) {
      return {
        ok: false,
        code: "ALREADY_EXISTS",
        message: `对象 '${newObjectId}' 已存在于 main（canonical）——不能重建。`,
      } as const;
    }
    // 当前 worktree 已存在？（同 session 内重复建）
    if (await objectExists(wtRef)) {
      return {
        ok: false,
        code: "ALREADY_EXISTS",
        message: `对象 '${newObjectId}' 已存在于本 session worktree——不能重建。`,
      } as const;
    }

    // 建骨架（package.json + 空 self + 空 readable）→ 填内容。复用 createStoneObject，不重写骨架逻辑。
    await createStoneObject(wtRef);
    await writeSelf(wtRef, selfMd);
    await writeReadable(wtRef, readableMd);

    if (knowledge && Object.keys(knowledge).length > 0) {
      const kDir = stoneKnowledgeDir(wtRef);
      await mkdir(kDir, { recursive: true });
      for (const [filename, content] of Object.entries(knowledge)) {
        await writeFile(join(kDir, filename), content, "utf8");
      }
    }

    // 不 commit：留 session worktree（本 session 即可用）。session 永不合入——进 canonical 走 feat-branch PR。
    return { ok: true, objectId: newObjectId, worktreePath: stoneDir(wtRef) } as const;
  });
}
