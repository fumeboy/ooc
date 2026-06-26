/**
 * agent —— persistable 维度（身份 self.md 的序列化）。
 *
 * agent 实例的身份正文 `data.self` 是 agent class 的版本化字段（VERSIONED_FIELDS=["self"]），
 * 落点按 `ctx.scope` 分支（issue C 三层重定位）：
 *
 * - `scope="flow"`（method 路径恒为此）：写 worktree 内 self.md 副本（`resolveStoneIdentityRef`
 *   解析到 session worktree branch `session-<sid>`，物理 = `flows/<sid>/objects/<id>/self.md`）。
 *   这是「self.md 作为版本化字段的持久化格式映射」——可读 markdown 而非裸 data.json 字段。
 *   同时整份 data 也由 runtime 的缺省 `data.json` 落盘（writeFile 走外层 saveObjectData），
 *   两路并存（外层负责 data.json 全字段；本 save 负责把 self 字段映射成 self.md 文件名）。
 *
 * - `scope="stone"`（仅 super flow 内的 reflect method 调用，issue D 主体）：写 `stones/main/objects/<id>/self.md`
 *   作为 canonical 版本化值。**本 issue 不主动以此 scope 调用**——仅实现兼容入口。
 *
 * - `scope="pool"`：N/A（agent 没有 pool 字段）。
 *
 * load：从 self.md 读回 self；无则返回 undefined（走系统缺省，data.self 为空）。
 * load 永远从 session worktree（如有）/main 读 canonical——不分 scope。
 */
import type {
  PersistableContext,
  PersistableModule,
} from "@ooc/core/types/persistable.js";
import { readSelf, writeSelf } from "./self-md.js";
import {
  resolveStoneIdentityRef,
  type StoneObjectRef,
} from "@ooc/core/persistable/index.js";
import type { Data } from "../types.js";

const persistable: PersistableModule<Data> = {
  save: async (ctx: PersistableContext, data: Data) => {
    if (ctx.scope === "pool") return; // agent 无 pool 字段；no-op
    if (ctx.scope === "stone") {
      // super flow 内的 reflect method 调用（issue D）；直写 stones/main/objects/<id>/self.md，bypass session worktree。
      const mainRef: StoneObjectRef = { baseDir: ctx.baseDir, objectId: ctx.objectId };
      await writeSelf(mainRef, data.self ?? "");
      return;
    }
    // scope="flow"（默认 / method 路径）：写 session worktree 内 self.md 副本。
    const ref = await resolveStoneIdentityRef(
      { baseDir: ctx.baseDir, objectId: ctx.objectId, sessionId: ctx.sessionId },
      "write",
    );
    await writeSelf(ref, data.self ?? "");
  },
  load: async (ctx: PersistableContext): Promise<Data | undefined> => {
    const ref = await resolveStoneIdentityRef(
      { baseDir: ctx.baseDir, objectId: ctx.objectId, sessionId: ctx.sessionId },
      "read",
    );
    const self = await readSelf(ref);
    return self !== undefined ? { self } : undefined;
  },
};

export default persistable;
