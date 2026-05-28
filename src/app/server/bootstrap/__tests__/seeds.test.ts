/**
 * bootstrap/seeds 单元测试。
 *
 * 覆盖：
 * - 空 world → ensureSupervisorStone + ensureUserStone 创建文件
 * - 幂等：再次调用不覆盖
 * - runBootstrapSeeds: 两个 stones 都创建
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
    ensureSupervisorStone,
    ensureUserStone,
    runBootstrapSeeds,
    SUPERVISOR_STONE_NAME,
    USER_STONE_NAME,
} from "../seeds";

async function makeTempWorld(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "ooc-seeds-test-"));
}

describe("ensureSupervisorStone", () => {
    let worldRoot: string;

    beforeEach(async () => {
        worldRoot = await makeTempWorld();
    });

    afterEach(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("空 world → 创建 supervisor stone 文件", async () => {
        const result = await ensureSupervisorStone(worldRoot, "main");
        expect(result.created).toBe(true);

        const selfPath = path.join(worldRoot, "stones", "main", "objects", SUPERVISOR_STONE_NAME, "self.md");
        const readmePath = path.join(worldRoot, "stones", "main", "objects", SUPERVISOR_STONE_NAME, "readme.md");
        const selfContent = await fs.readFile(selfPath, "utf8");
        const readmeContent = await fs.readFile(readmePath, "utf8");

        expect(selfContent).toContain("extends: root");
        expect(selfContent).toContain("Supervisor");
        expect(readmeContent).toContain("Supervisor");
    });

    test("再次调用 → 幂等（created: false，不覆盖）", async () => {
        await ensureSupervisorStone(worldRoot, "main");

        // 修改 self.md，验证第二次调用不覆盖
        const selfPath = path.join(worldRoot, "stones", "main", "objects", SUPERVISOR_STONE_NAME, "self.md");
        await fs.writeFile(selfPath, "CUSTOM CONTENT");

        const result2 = await ensureSupervisorStone(worldRoot, "main");
        expect(result2.created).toBe(false);

        // 内容未被覆盖
        const content = await fs.readFile(selfPath, "utf8");
        expect(content).toBe("CUSTOM CONTENT");
    });

    test("自定义 branch → 创建在正确目录", async () => {
        const result = await ensureSupervisorStone(worldRoot, "my-branch");
        expect(result.created).toBe(true);

        const selfPath = path.join(worldRoot, "stones", "my-branch", "objects", SUPERVISOR_STONE_NAME, "self.md");
        const content = await fs.readFile(selfPath, "utf8");
        expect(content).toContain("Supervisor");
    });
});

describe("ensureUserStone", () => {
    let worldRoot: string;

    beforeEach(async () => {
        worldRoot = await makeTempWorld();
    });

    afterEach(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("空 world → 创建 user stone 文件", async () => {
        const result = await ensureUserStone(worldRoot, "main");
        expect(result.created).toBe(true);

        const selfPath = path.join(worldRoot, "stones", "main", "objects", USER_STONE_NAME, "self.md");
        const readmePath = path.join(worldRoot, "stones", "main", "objects", USER_STONE_NAME, "readme.md");
        const selfContent = await fs.readFile(selfPath, "utf8");
        const readmeContent = await fs.readFile(readmePath, "utf8");

        expect(selfContent).toContain("extends: root");
        expect(selfContent).toContain("User");
        expect(readmeContent).toContain("User");
    });

    test("再次调用 → 幂等（created: false，不覆盖）", async () => {
        await ensureUserStone(worldRoot, "main");

        const selfPath = path.join(worldRoot, "stones", "main", "objects", USER_STONE_NAME, "self.md");
        await fs.writeFile(selfPath, "MY CUSTOM USER");

        const result2 = await ensureUserStone(worldRoot, "main");
        expect(result2.created).toBe(false);

        const content = await fs.readFile(selfPath, "utf8");
        expect(content).toBe("MY CUSTOM USER");
    });
});

describe("runBootstrapSeeds", () => {
    let worldRoot: string;

    beforeEach(async () => {
        worldRoot = await makeTempWorld();
    });

    afterEach(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("空 world → 两个 stones 都创建 (created: true)", async () => {
        const result = await runBootstrapSeeds(worldRoot, "main");
        expect(result.supervisor.created).toBe(true);
        expect(result.user.created).toBe(true);

        // 文件真实存在
        const supervisorSelf = path.join(worldRoot, "stones", "main", "objects", SUPERVISOR_STONE_NAME, "self.md");
        const userSelf = path.join(worldRoot, "stones", "main", "objects", USER_STONE_NAME, "self.md");
        // fs.access 成功时 resolve（不抛错即可）
        await fs.access(supervisorSelf);
        await fs.access(userSelf);
    });

    test("再次调用 → 幂等（两个都 created: false）", async () => {
        await runBootstrapSeeds(worldRoot, "main");
        const result2 = await runBootstrapSeeds(worldRoot, "main");
        expect(result2.supervisor.created).toBe(false);
        expect(result2.user.created).toBe(false);
    });

    test("supervisor 与 user self.md 内容正确", async () => {
        await runBootstrapSeeds(worldRoot, "main");

        const supervisorSelf = await fs.readFile(
            path.join(worldRoot, "stones", "main", "objects", SUPERVISOR_STONE_NAME, "self.md"),
            "utf8",
        );
        const userSelf = await fs.readFile(
            path.join(worldRoot, "stones", "main", "objects", USER_STONE_NAME, "self.md"),
            "utf8",
        );

        // supervisor self.md contains key fields
        expect(supervisorSelf).toContain("extends: root");
        expect(supervisorSelf).toContain("Supervisor");
        expect(supervisorSelf).toContain("orchestrates");

        // user self.md contains key fields
        expect(userSelf).toContain("extends: root");
        expect(userSelf).toContain("User");
        expect(userSelf).toContain("talk");
    });
});
