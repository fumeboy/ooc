/**
 * 对象类型（selfKind）识别（Phase 7）
 *
 * 根据 stoneDir 在文件系统中的位置，判断当前对象是 "stone"（持久对象）
 * 还是 "flow_obj"（flow 内的临时对象）。flow_obj 场景下同时解出 sessionId。
 *
 * 规则：
 * - 若 stoneDir 落在 `flowsDir/<sid>/objects/<name>`（及其子路径）下 → flow_obj
 *   · 返回 selfKind="flow_obj" + sessionId=<sid>
 * - 其他情况（stones/<name>、自定义路径等）→ stone
 *
 * 用途：
 * - virtual-path.ts / relation.ts 的 selfKind / sessionId 参数
 * - 让 @trait:self/X 和 @relation:X 在 flow_obj 场景下也指向正确目录
 *
 * 设计：
 * - 纯字符串计算，不触碰文件系统
 * - 形态不匹配时保守回退到 stone（避免误判把 stones 操作导向 flows/）
 *
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#第三部分-target终点
 */

/** 对象类型识别结果 */
export interface SelfKindInfo {
  selfKind: "stone" | "flow_obj";
  /** 仅 flow_obj 时填 */
  sessionId?: string;
}

/**
 * 根据 stoneDir 与 flowsDir 的关系判断 selfKind + sessionId
 *
 * @param stoneDir 当前对象的根目录（stone.dir 或等价物）
 * @param flowsDir 项目的 flows/ 根目录
 */
export function detectSelfKind(stoneDir: string, flowsDir: string): SelfKindInfo {
  if (!stoneDir || !flowsDir) return { selfKind: "stone" };

  /* 规整末尾斜杠 */
  const stone = stoneDir.replace(/\/+$/, "");
  const flowsNorm = flowsDir.replace(/\/+$/, "");

  if (!stone.startsWith(flowsNorm + "/")) return { selfKind: "stone" };

  const rel = stone.slice(flowsNorm.length + 1); /* 去掉 "flowsDir/" 前缀 */
  /* 期望形态：<sid>/objects/<name>[/...] */
  const parts = rel.split("/");
  if (parts.length < 3) return { selfKind: "stone" };
  const sid = parts[0];
  const marker = parts[1];
  const name = parts[2];
  if (!sid || marker !== "objects" || !name) return { selfKind: "stone" };

  return { selfKind: "flow_obj", sessionId: sid };
}
