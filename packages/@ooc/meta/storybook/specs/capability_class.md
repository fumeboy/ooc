# Capability: class（一等继承抽象）

**维度定位**：class 与 object 平级、不可交互、仅供继承；builtin=class（`_builtin/<id>` 寻址）、world=object 实例、`ooc.class` 继承、`instantiate_with_new_world` 自动实例化。权威：`meta/object.doc.ts` class_object 节点 + `docs/ooc-6/class-abstraction.md`。

## Tier A —— 控制面确定性（已实现，stories/class.story.ts）
- TC-CLASS-01：instantiate_with_new_world 幂等实例化 supervisor class → objects/ object（拷贝 self.md + ooc.class）。
- TC-CLASS-02：实例化幂等 —— 二次 bootstrap 跳过、保用户改动。
- TC-CLASS-03：instance 经 class 链继承框架 class 的 seed knowledge（eight-dimensions / world-vocabulary）。
- TC-CLASS-04：class 不可交互 —— seedSession 拒绝 `_builtin/` class 目标。

## Tier B —— agent-native（真 LLM，env-gated）
- startApp + 实例化 supervisor，派任务证明 supervisor 自动加载 self.md 身份 + 继承知识（不靠 LLM 即兴演角色）。
- rubric：
  - **Good**：回复复现 self.md 设计身份 + 引用继承的 seed knowledge（8 维度/治理操作）。
  - **OK**：身份对但未引用知识。
  - **Bad**：即兴演角色 / 身份缺失。
