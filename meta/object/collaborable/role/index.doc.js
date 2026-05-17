import * as stoneObject from "@src/persistable/stone-object";
import * as flowObject from "@src/persistable/flow-object";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";

/**
 * Role 概念：协作网络中不同 Object 的职责定位。
 *
 * sources（role 不是单独的运行时类型，而是 stone / flow object 上的语义角色）:
 *  - stoneObject — Object 的静态身份目录
 *  - flowObject  — Object 在某 session 内的运行态目录
 */
export const role_v20260506_1 = {
  name: "Role",
  get parent() { return collaborable_v20260504_1; },
  sources: {
    stoneObject,
    flowObject,
  },
  description: `
Role 描述协作网络中不同 Object 的职责定位。按子字段展开：
homogeneousBase / semanticOverlay / supervisorSpecialization。
`.trim(),

  homogeneousBase_v20260517_1: {
    index: `
## homogeneousBase — 持久化层同构

OOC 中所有 Object 在持久化层都是同构的（stone + flow 目录），
角色差异不体现在目录结构上。
`.trim(),
  },

  semanticOverlay_v20260517_1: {
    index: `
## semanticOverlay — 语义角色叠加

role 是叠加在同构对象之上的语义角色：哪些对象承担用户接入、
哪些承担任务派发、哪些承担专业执行。
`.trim(),
  },

  supervisorSpecialization_v20260517_1: {
    index: `
## supervisorSpecialization — supervisor 特化

supervisor 是其中一个特化角色，承担 user 接入与任务派发，
详见 \`collaborable.supervisor\`。
`.trim(),
  },
};
