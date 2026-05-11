import { object_v20260504_1 } from "@meta/object/index.doc";
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import { extendable_v20260504_1 } from "@meta/object/extendable/index.doc";
import { observable_v20260504_1 } from "@meta/object/observable/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";
import { iteration_v20260511_1 } from "@meta/iteration.doc";
import { app_tree_v20260511_1 } from "@meta/app/index.doc";

export { object_v20260504_1 } from "@meta/object/index.doc";

export const object_tree_v20260504_1 = {
  get parent() { return object_v20260504_1; },
  index: `
Object 能力维度包括 thinkable / collaborable / executable / persistable / extendable / observable / reflectable。
`,
  thinkable: thinkable_v20260504_1,
  collaborable: collaborable_v20260504_1,
  executable: executable_v20260504_1,
  persistable: persistable_v20260504_1,
  extendable: extendable_v20260504_1,
  observable: observable_v20260504_1,
  reflectable: reflectable_v20260504_1,
};

export const meta_v20260506_1 = {
  index: `
kernel/meta 是 OOC 的元文档入口。

- object：系统是什么（按能力维度）
- app：系统如何对外提供应用层入口
- engineering：我们如何做（实践侧元循环）
- iteration：本项目的迭代过程（按时间线追溯每次产出）
`,
  object: object_tree_v20260504_1,
  app: app_tree_v20260511_1,
  engineering: engineering_v20260506_1,
  iteration: iteration_v20260511_1,
};
