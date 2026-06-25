/**
 * reflectable —— 自我迭代通道。
 *
 * 设计权威：`.ooc-world-meta/.../children/reflectable/self.md`。
 *
 * 两条沉淀路径：
 * - **pool sediment**（直写即生效）：写 `pools/objects/<owner>/knowledge/*.md` / 记忆条目。
 * - **stone change**（git feat-branch PR）：派生 feat branch worktree → 编辑 → commit → 开 PR
 *   → reviewer 审批 → merge 进 stones/main。
 *
 * 当前最小实现：
 * - `sedimentKnowledge(baseDir, ownerId, path, body)` —— 直写 pool sediment
 * - `createObjectSkeleton(baseDir, objectId, selfMd, readableMd?, knowledge?)` —— 写 stones/main
 *   下新对象骨架（不走 git feat-branch；feat-branch PR 通道待 git versioning 重建）
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nestedObjectPath, toJson } from "./common.js";

/** 写一条 pool sediment knowledge（直写即生效；不进 git）。 */
export async function sedimentKnowledge(
  baseDir: string,
  ownerObjectId: string,
  path: string,
  body: string,
): Promise<void> {
  const dir = join(baseDir, "pools", "objects", ownerObjectId, "knowledge");
  const segments = path.split("/");
  const file = segments.pop()!;
  const subDir = segments.length > 0 ? join(dir, ...segments) : dir;
  await mkdir(subDir, { recursive: true });
  await writeFile(join(subDir, `${file}.md`), body, "utf8");
}

/**
 * 写新对象骨架到 stones/main/objects/<id>/ ——直写、不经 feat-branch（极简）。
 *
 * 长期：reflectable feat-branch 通道激活后，此函数改为派生 feat-branch worktree → 写文件 →
 * commit → 开 PR；当前是不带 git versioning 的「写就生效」最小版。
 */
export interface CreateObjectSkeletonInput {
  baseDir: string;
  objectId: string;
  selfMd: string;
  readableMd?: string;
  /** filename → body（不带 .md 后缀） */
  knowledge?: Record<string, string>;
  /** package.json ooc.class 字段（继承父类）。 */
  parentClass?: string;
}

export interface CreateObjectSkeletonResult {
  ok: true;
  objectId: string;
  dir: string;
}

export async function createObjectSkeleton(
  input: CreateObjectSkeletonInput,
): Promise<CreateObjectSkeletonResult> {
  const { baseDir, objectId, selfMd, readableMd, knowledge, parentClass } = input;
  const segments = nestedObjectPath(objectId);
  const dir = join(baseDir, "stones", "main", "objects", ...segments);
  await mkdir(dir, { recursive: true });
  // self.md
  await writeFile(join(dir, "self.md"), selfMd, "utf8");
  // readable.md
  if (readableMd !== undefined) {
    await writeFile(join(dir, "readable.md"), readableMd, "utf8");
  }
  // package.json
  const pkg: { name: string; type: string; ooc: { objectId: string; kind: string; class?: string } } = {
    name: `@ooc-world/${objectId.replaceAll("/", "-")}`,
    type: "module",
    ooc: { objectId, kind: "object" },
  };
  if (parentClass) pkg.ooc.class = parentClass;
  await writeFile(join(dir, "package.json"), toJson(pkg), "utf8");
  // knowledge/
  if (knowledge && Object.keys(knowledge).length > 0) {
    const kdir = join(dir, "knowledge");
    await mkdir(kdir, { recursive: true });
    for (const [name, body] of Object.entries(knowledge)) {
      await writeFile(join(kdir, `${name}.md`), body, "utf8");
    }
  }
  return { ok: true, objectId, dir };
}
