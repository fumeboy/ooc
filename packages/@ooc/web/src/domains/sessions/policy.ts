import type { Stone } from "../stones";

/**
 * supervisor 是 OOC World 的「user 与系统交互的首选入口」（见 builtin supervisor self.md）。
 * 后端 listStones 已把它合入对话目标列表，这里把它设为 SessionCreator 的默认选中项：
 * 用户进入全新 world 即可直接和 supervisor 发起会话，无需先创建自定义 stone。
 */
const DEFAULT_TALK_TARGET_OBJECT_ID = "supervisor";

export function defaultSessionId() {
  return `web-${Date.now()}`;
}

export function defaultObjectId(stones: Stone[]) {
  if (stones.some((stone) => stone.objectId === DEFAULT_TALK_TARGET_OBJECT_ID)) {
    return DEFAULT_TALK_TARGET_OBJECT_ID;
  }
  return stones[0]?.objectId ?? "";
}

