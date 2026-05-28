/**
 * Bootstrap seeds: 首次 --world 加载时自动创建 supervisor + user stones。
 *
 * 设计原则：
 * - 幂等：文件已存在时不覆盖（检查 self.md 是否存在）
 * - 不依赖 git（stone-bootstrap 已负责 git 初始化；seeds 只管目录+文件）
 * - 错误快速上浮（不静默吞错）
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

/** supervisor stone 所在的 object 目录名。 */
export const SUPERVISOR_STONE_NAME = "supervisor";

/** user stone 所在的 object 目录名。 */
export const USER_STONE_NAME = "user";

/**
 * supervisor stone 的 self.md 内容。
 */
const SUPERVISOR_SELF_MD = `---
extends: root
title: Supervisor
description: Root parent of OOC world; orchestrates harness, holds modification authority over all branch children.
---

# Supervisor

The Supervisor is the root Object of the OOC world. It orchestrates the agent harness,
coordinates AgentOfX sub-agents, and holds modification authority over all branch children.
`;

/**
 * supervisor stone 的 readme.md 内容。
 */
const SUPERVISOR_README_MD = `# Supervisor

Root parent of the OOC world.

## Role

- Orchestrates the agent harness (1 Supervisor + N AgentOfX)
- Holds modification authority over branch children
- Arbitrates cross-dimension design conflicts
- Maintains meta/*.doc.ts canonical design decisions
`;

/**
 * user stone 的 self.md 内容。
 */
const USER_SELF_MD = `---
extends: root
title: User
description: Human user placeholder; talk targets / inbox for outside world interactions.
---

# User

The User is the human-side placeholder Object. All outside-world interactions (chat messages,
task submissions, feedback) arrive via this Object's talk inbox.
`;

/**
 * user stone 的 readme.md 内容。
 */
const USER_README_MD = `# User

Human user placeholder Object.

## Role

- Receives talk messages from human users via \`POST /api/talk\`
- Provides a stable \`ooc://stones/main/objects/user\` URI for addressing the human
- Inbox for all outside-world interactions
`;

/**
 * 判断文件是否存在。
 */
async function exists(p: string): Promise<boolean> {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * 在 objectDir 下写入 self.md + readme.md（仅当 self.md 不存在时）。
 * 返回 true 表示本次真的创建了文件，false 表示已存在（幂等跳过）。
 */
async function ensureStoneFiles(
    objectDir: string,
    selfContent: string,
    readmeContent: string,
): Promise<boolean> {
    const selfPath = join(objectDir, "self.md");
    if (await exists(selfPath)) {
        return false; // 幂等：已存在不覆盖
    }
    await mkdir(objectDir, { recursive: true });
    await writeFile(selfPath, selfContent, "utf8");
    await writeFile(join(objectDir, "readme.md"), readmeContent, "utf8");
    return true;
}

/**
 * 确保 supervisor stone 存在。
 * 若 stones/<branch>/objects/supervisor/self.md 不存在则创建目录 + 文件。
 */
export async function ensureSupervisorStone(worldRoot: string, branch: string): Promise<{ created: boolean }> {
    const objectDir = join(worldRoot, "stones", branch, "objects", SUPERVISOR_STONE_NAME);
    const created = await ensureStoneFiles(objectDir, SUPERVISOR_SELF_MD, SUPERVISOR_README_MD);
    return { created };
}

/**
 * 确保 user stone 存在。
 * 若 stones/<branch>/objects/user/self.md 不存在则创建目录 + 文件。
 */
export async function ensureUserStone(worldRoot: string, branch: string): Promise<{ created: boolean }> {
    const objectDir = join(worldRoot, "stones", branch, "objects", USER_STONE_NAME);
    const created = await ensureStoneFiles(objectDir, USER_SELF_MD, USER_README_MD);
    return { created };
}

/**
 * 运行所有 bootstrap seeds（目前：supervisor + user）。
 * 幂等：重复调用安全，已存在时跳过。
 */
export async function runBootstrapSeeds(worldRoot: string, branch: string): Promise<{
    supervisor: { created: boolean };
    user: { created: boolean };
}> {
    const [supervisor, user] = await Promise.all([
        ensureSupervisorStone(worldRoot, branch),
        ensureUserStone(worldRoot, branch),
    ]);
    return { supervisor, user };
}
