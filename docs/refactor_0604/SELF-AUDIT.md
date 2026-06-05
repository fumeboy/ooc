# 模块自检：对照 README 理想架构（阶段三 ③）

> Supervisor 在 ooc-6 阶段三对各 core 模块做"对照当初文档预期"的自检。
> 方法：以 `README.md` §3.1（无环依赖方向）+ §3.2（职责边界）为基准，扫当前
> `packages/@ooc/core/*` 的跨模块 import，识别与理想的偏离并分类。
> 最后更新：2026-06-05（F3 恢复后）

## 模块存在性 vs §3.1

| 理想模块 | 现状 |
|---|---|
| `_shared/types` + `_shared/utils` | ✅ 存在，零业务（见下） |
| `executable` / `thinkable` | ✅ |
| `persistable` / `programmable` / `runtime` | ✅（programmable 由 E1 抽出） |
| `observable` | ⚠️ 仍独立；§理想是并入 runtime（**F1 推迟**，DD3） |
| `app/server` / `builtins` | ✅ |
| `extendable`（额外） | 非能力维度的外接集成层，不在 §3.1 图内（设计如此） |

## 依赖方向无环检查（§3.1：依赖只能从下往上，反向 = 设计问题）

**合规**：
- ✅ `_shared/*` 不 import 任何业务模块（零业务契约成立）
- ✅ `programmable → persistable` 单向，无 `persistable → programmable` 的**实现**反向

**残留反向（按根因分类）**：

1. **【真 gap·批次 C registry 收口未完成】builtinRegistry/ObjectRegistry 实例位置**
   - `_shared/types/registry.ts` 注释自称 canonical 拥有 `ObjectRegistry class`/`builtinRegistry singleton`/`createObjectRegistry`，但实际只 export `filterMethodsByVisibility`+类型；实例真身在 `runtime/object-registry.ts:284`（`new ObjectRegistry()`）。
   - 后果：`persistable/{debug-file,flow-object,thread-json}.ts` 通过 `executable/windows/index` re-export 拿 builtinRegistry（value import）→ `persistable → executable` **伪反向**；叠加既有 `runtime → persistable`（server-loader 等 5 处），形成 runtime↔persistable↔executable 的 registry 纠葛。
   - **修复建议**：把 `ObjectRegistry` class + `builtinRegistry` 实例 + `createObjectRegistry` 迁入 `_shared/types/registry.ts`（注释已预告的 canonical 位置，最底层无环），runtime/executable 改 re-export。一次消除多处反向。属 batch C 深化，需确保 ObjectRegistry class 零业务（仅注册容器）后再迁。

2. **【推迟项·E4】`persistable/thread-json.ts → executable/windows/_shared/init`（initContextWindows）**
   - thread rehydrate 逻辑（DD2 裁决 E4 推迟到 harness 阶段，session-loading 运行时敏感）。

3. **【过渡兼容·E1】`persistable/index.ts → programmable/*`（barrel re-export）**
   - E1 抽出 programmable 后留的向后兼容 re-export（DD2 有意保留）；理想终态是调用方直接 `import @ooc/core/programmable`，persistable barrel 不再 re-export。

4. **【设计性·运行时编排】`thinkable/{thinkloop,knowledge/activator} → executable`**
   - thinkloop 顶层 think 循环需调 executable 的 tool dispatch / permissions；activator 命中 command 路径。属顶层编排对行动层的调用（G4 已破 xml 渲染耦合；tool dispatch 依赖是 think→act 的本质，非债务）。

5. **【职责 gap】`persistable/stone-skills.ts → thinkable/knowledge/parser`（parseKnowledgeFile）**
   - persistable 在解析 knowledge frontmatter，越界到 thinkable 职责。`parseKnowledgeFile` 宜下沉 `_shared/utils`（纯文本解析无业务），或 stone-skills 不承担解析。

## 结论

主干模块结构已达成 README 理想布局；**残留反向依赖无一是本轮（batch A–G + F3）引入的回归**，分布为：
- 批次 C registry 收口未完成（#1，多处反向的共同根因，**最值得后续修**）
- 已知推迟项（#2 E4 / #3 E1 / observable→runtime F1 / logger D6）
- 设计性运行时编排（#4，非债务）
- 个别职责越界（#5，小修）

彻底实现 §3.1 无环，需：①完成 `_shared/types/registry` 收编 builtinRegistry/ObjectRegistry ②落地 harness 阶段推迟项（E4/F1/D6）③下沉 parseKnowledgeFile。这些是 batch C 深化 + 推迟项落地，建议作为 ooc-6 后续单独批次，不与 F3 收尾混做（控制复杂度）。
