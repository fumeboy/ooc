import type { DocNode } from "@meta/doc-types";
import { object_v20260504_1 } from "@meta/object/index.doc";
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import { extendable_v20260504_1 } from "@meta/object/extendable/index.doc";
import { observable_v20260517_1 } from "@meta/object/observable/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";
import { iteration_v20260511_1 } from "@meta/iteration.doc";
import { app_tree_v20260511_1 } from "@meta/app/index.doc";

export { object_v20260504_1 } from "@meta/object/index.doc";

/* ────────────────────────────────────────────────────────────────
 *  object_tree：把 Object 7 个能力维度挂在 object 概念下
 * ──────────────────────────────────────────────────────────────── */

export const object_tree_v20260504_1: DocNode & {
  readonly parent: unknown;
  thinkable: typeof thinkable_v20260504_1;
  collaborable: typeof collaborable_v20260504_1;
  executable: typeof executable_v20260504_1;
  persistable: typeof persistable_v20260504_1;
  extendable: typeof extendable_v20260504_1;
  observable: typeof observable_v20260517_1;
  reflectable: typeof reflectable_v20260504_1;
} = {
  get parent() {
    return object_v20260504_1;
  },
  title: "Object 能力维度",
  content:
    "Object 能力维度包括 thinkable / collaborable / executable / persistable / extendable / observable / reflectable。",
  thinkable: thinkable_v20260504_1,
  collaborable: collaborable_v20260504_1,
  executable: executable_v20260504_1,
  persistable: persistable_v20260504_1,
  extendable: extendable_v20260504_1,
  observable: observable_v20260517_1,
  reflectable: reflectable_v20260504_1,
};

/* ────────────────────────────────────────────────────────────────
 *  meta：OOC 元文档顶层
 * ──────────────────────────────────────────────────────────────── */

export const meta_v20260506_1: DocNode & {
  object: typeof object_tree_v20260504_1;
  app: typeof app_tree_v20260511_1;
  engineering: typeof engineering_v20260506_1;
  iteration: typeof iteration_v20260511_1;
} = {
  title: "meta 元文档入口",
  content: `
kernel/meta 是 OOC 的元文档入口。

- object：系统是什么（按能力维度）
- app：系统如何对外提供应用层入口
- engineering：我们如何做（实践侧元循环）
- iteration：本项目的迭代过程（按时间线追溯每次产出）
  `.trim(),
  object: object_tree_v20260504_1,
  app: app_tree_v20260511_1,
  engineering: engineering_v20260506_1,
  iteration: iteration_v20260511_1,
};
