# OOC Class 自动实例化 + welcome 闭环设计（Spec B）

> 状态：设计稿（2026-06-07）。**依赖 Spec A**
> （`docs/2026-06-07-ooc-class-first-class-inheritance-design.md`：class 一等化 + 命名空间 +
> class 链文件解析 + 剔除 prototype）。本 spec 负责：builtin class 在新 world 自动实例化出
> 可交互 object、talk 目标仅 objects、移除过渡逻辑 `withBuiltinTalkTargets`，闭合「全新
> world 即可与 supervisor 对话且加载真实身份」的体验。

## 1. 目标
全新 OOC World bootstrap 后，自动存在一个可交互的 `supervisor` object（继承 builtin
`supervisor` class），welcome 默认即可对话，且对话时 thinkloop **真正加载 supervisor 的
self.md 身份**——不再撞「需要先创建至少一个 stone」，也不再靠 LLM 即兴演角色。

## 2. instantiate_with_new_world
- class `package.json` 声明 `ooc.instantiate_with_new_world: true`。
- `supervisor` class（`packages/@ooc/builtins/supervisor`）的 package.json 改为
  `ooc.kind="class"`, `ooc.instantiate_with_new_world=true`。

## 3. bootstrap 实例化循环（解 v1 C3）
**新增**独立 bootstrap 步骤（非现有 `BUILTIN_OBJECT_IDS` pool 循环，`index.ts:282`）：
1. 枚举所有已注册 class（框架 builtin class + world `stones/<branch>/classes/`），依赖 Spec A
   的 class registry 可枚举。
2. 对每个 `instantiate_with_new_world===true` 的 class，**幂等**实例化 object：
   - 目标 object id：默认 = class id（singleton 约定；多实例是 Spec A 已支持的通用能力，
     此处只做 singleton 自动化）。
   - 落 `stones/main/objects/<id>/`：写 `package.json`（`ooc.objectId=<id>`,
     `ooc.kind="object"`, `ooc.class=<classId>`）+ **拷贝 class 的 self.md**（own 身份，
     读 class 经 Spec A §3 原语从框架包/classes 取）。
   - commit on main（走 stone-versioning worktree → ff merge）。
   - **object 已存在则跳过**（幂等，保住用户对 self.md 的改动）。
- pool 骨架：实例化的 object 仍需 pool（沿用 `createPoolObject`）。

## 4. talk 目标仅 objects + 移除过渡逻辑
- **移除 `withBuiltinTalkTargets`**（Spec A 阶段保留的过渡逻辑，
  `app/server/modules/stones/service.ts`，commit c44a0042）——supervisor 现在是
  `stones/main/objects/supervisor/` 真 object，listStones 正常返回。
- listStones（或其替代）只返回 `objects/`，**不返回 classes/**（class 不可 talk）。
- seedSession 拒绝 class target（Spec A §5.3 已实现判别）。
- 前端 `defaultObjectId` 优先 supervisor 保留（现指向真 object，无害）；
  `BUILTIN_TALK_TARGET_IDS` / supervisor 在 `BUILTIN_OBJECT_IDS` 的特殊解析退场，
  `user` 仍作 caller。

## 5. 验证
- **单测**：bootstrap 后 `objects/supervisor/` 存在，含 self.md 拷贝（非空）+
  `ooc.class="supervisor"`；二次 bootstrap 幂等（不覆盖改动）；listStones 含 supervisor
  object、不含任何 class；seedSession target=class → INVALID_INPUT。
- **e2e backend**（`app.handle` 直调）：全新 world bootstrap → supervisor object 自动存在 →
  seedSession(supervisor) → 跑 thinkloop → context snapshot 的 self instructions **非空且
  含 supervisor self.md 内容**（证明身份真正加载，区别于 Spec A 前的「即兴演」）。
- **harness 体验**：前后端起新 world → welcome 默认 supervisor → 对话 → 观察 self.md 身份
  已注入。

## 6. 风险
- 既有 world 迁移：下次 boot 幂等建出 supervisor object；旧 session objectId="supervisor"
  从 builtin 路径切到新实例 object——行为等价或更好（实例 self.md 现在能加载）。无破坏性迁移。
- self.md 快照漂移：见 Spec A §6 M1 的已知 trade-off。
