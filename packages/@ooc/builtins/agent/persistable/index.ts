/**
 * agent —— persistable 维度（身份 self.md 的序列化）。
 *
 * agent 实例的身份正文 `data.self` 落实例目录的 **self.md**（self.md 只属 ooc agent 实例，
 * 见对象模型核心 9）。读写都经 `resolveStoneIdentityRef`（persistable 维度纪律：session-aware
 * 路由，绝不自建裸 main ref），落 stone 身份层（`stones/.../objects/<id>/self.md`）。
 *
 * save：把 `data.self` 写进 self.md。
 * load：从 self.md 读回 self；无则返回 undefined（走系统缺省，data.self 为空）。
 */
import type {
  PersistableContext,
  PersistableModule,
} from "@ooc/core/types/persistable.js";
import { readSelf, writeSelf } from "./self-md.js";
import { resolveStoneIdentityRef } from "@ooc/core/persistable/index.js";
import type { Data } from "../types.js";

const persistable: PersistableModule<Data> = {
  save: async (ctx: PersistableContext, data: Data) => {
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
