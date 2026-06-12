# ContextWindow = 纯投影：buffer/view 分离 + 开放类型轴

> 2026-06-12 · Supervisor 设计裁决 + 理想设计 demo
> 范围：builtin object 与内置 context window 的形是否合理，更优雅的形长什么样。
> 状态：**design-first，未动 `packages/@ooc/` 源码**。HOLD tiling（见 §7）。

---

## 0. 一句话

能力是对的，分类是乱的；最深的病是——**核心抽象命名为「window」，哲学里却刻意拒绝了窗口管理器的心智模型（选了 OS 进程树）**，于是 OOC 继承了窗口系统的全部*问题*（折叠、遮挡、预算、布局），却没继承它们任何一个*解法*。名字开了一张机制兑现不了的支票。

正确的解不是把桌面 WM 整套搬进来，而是吸收**所有好窗口系统共享、OOC 独缺的那一条不变量**：Emacs/vim 的 **buffer/window 分离**——它正是 Smalltalk MVC 的种子，而 Smalltalk 同时发明了窗口与面向对象。OOC 叫 *Object Oriented Context*，它该继承的是 Smalltalk 的 MVC 纪律，不是桌面的杂乱。

---

## 1. 诊断：当前形的四笔债

### 合理、要保护的部分（重构勿碰）

- **4 个固定 tool 原语（exec/close/wait/compress）+ 一切皆 method**：新能力加 method/对象、不加顶层 tool。`method_exec` form 本身是一个 window，把「读→找工具→调用」塌缩成「对你看到的东西直接下动词」——这是 acme/Oberon「内容即可执行」在 LLM 上下文里的实现，是 OOC 论点跑通的地方。
- **三向 method 切分**：object method（动数据，`registerExecutable`）/ window method（只控展示，`registerReadable`）/ visible method（给人类 `for_ui_access`）。**你们在 method 层已经做了 buffer/view 分离。**
- **glossary 明令禁用「ContextObject」一词**，坚持 Object（实体）≠ ContextWindow（实体在 context 中的形态）。直觉完全正确。
- **渲染层已修「28% 水分」**：方法契约由 `renderWindowClassesNode` 在 `<window_classes>` 按 class 声明一次，实例只带 `class=` 引用（`xml.ts:161`、`:364`）。**且渲染走 `registry.getObjectDefinition(class)` + `compressView` hook 分派，根本没用那个 TS discriminated union**——记住这点，它是 §3/P2 的钥匙。

### 债 1 ——「builtin object」是一件套在三种角色上的戏服

12 个 builtin 实为三类，却共用同一张「五件套 + `_builtin/<id>` class」皮：

| 角色 | 成员 | 真相 |
|---|---|---|
| **base class** | `root` | 每个对象继承的通用动词面（15 个 ROOT_METHODS）。 |
| **buffer/内容 class** | `file` `knowledge` `plan` `program` `search` `todo` `skill_index` | 可复用的产窗类，**无人格、不跑 thinkloop、从不实例化**。`self.md` 是 5 行空壳——不是 bug，是戏服不合身的证据：五件套为 *Object* 裁，它们不是 Object。 |
| **agent class** | `supervisor` | 有人格、跑 thinkloop、bootstrap 进 `objects/`。**只有它真正走过 class→instance 机器。** |
| **proxy** | `user` | 人类占位，不跑 thinkloop。 |

迁移没做完：window-type builtin 还挂旧的 `ooc.type:"object"`，新世界已是 `ooc.kind`/`ooc.class`。**只有 supervisor 一个对象兑现了 class 抽象，其余 8 个还在演。**

### 债 2（最深）—— 三向切分在 method 层做了，在数据结构层又塌回去了

一个 `ContextWindow` struct 同时扛六重身份：

| 身份 | 证据（锚） |
|---|---|
| ① 数据持有 | `program.history` / `plan.steps` / `knowledge.body` / `do.targetThreadId`——**window 就是对象的状态** |
| ② 视图状态 | `state`（viewport/lines）、`compressLevel`、`effectiveVisibleType`（`context-window.ts:88-102`） |
| ③ 方法调用面 | `method_exec` 整个成员、`boundFormId`、`tip`（`context-window.ts:105,119`） |
| ④ 预算单元 | `provenance` / `relevance`，喂 `BudgetManager`（`context-window.ts:42-67`） |
| ⑤ 持久化单元 | 每窗一份 `state.json` + thread-context member（`window-persistence.ts:56-111`） |
| ⑥ 跨 thread 共享单元 | `SharingState` lent/ref + **冻结 snapshot**（`context-window.ts:132-146`） |

`isSelfWindow` + `isNonPersistedWindow` + `class: objectId as any`（`init.ts:186,245`）这三处特判，就是「对象身份漏进窗口数组」结出的疤。

**这一条可以用你们自己的文档钉死**：glossary 写「同一 Object 可同时出现在多个 thread，**状态只存一份**，每个 thread 只持视角参数」。可代码里 window member 直接装业务数据；跨 thread 共享时 `SharingState` 还**冻结一份 snapshot 拷贝** + lent/ref 记账——**这恰恰不是「只存一份」**。

> **结论：struct 违反了你们自己写下的 glossary。不需要新设计，需要让数据结构服从已经写好的文档。**

### 债 3 —— 窗口类型轴是闭合枚举，和「class 开放继承」自相矛盾

`windows/_shared/types.ts:84-99` 把 `ContextWindow` union 写死 15 个成员，core 直接 `import @ooc/builtins/file` *和* `extendable/lark/feishu-chat`。可方法轴是**开放**的（沿 parentClass 链运行时解析）。**同一系统：方法靠 registry 动态分派，渲染/类型却靠编译期 discriminated union。** 而 §1 已证：渲染期根本不用这个 union（走 registry 查表）——它在运行时已是死重，只有编译期类型系统还抱着它。

### 债 4 —— 有窗口管理器的全部问题，却没有布局/注意力纪律

thread 持有 flat array + parentWindowId + compressLevel + relevance 打分 + `<context_overflow>`，等于「一堆没有 z-order 纪律的堆叠窗口，靠预算管理器临时收拾」。这是堆叠式 WM 退化成杂乱的标准失败模式。**——但解法不是 tiling（见 §7）。**

---

## 2. 设计原则：借 Smalltalk MVC，不借桌面 WM

人类窗口范式扫了八种（Smalltalk/PARC、stacking vs tiling、buffer-vs-window、tabs、Stage Manager、minimize/dock、no-app/acme/Oberon、注意力经济）。对「context 稀缺 + 窗口是带方法的对象」这个场景，三条最相关：

1. **buffer/window 分离（最相关，安全不变量）**：DATA≠VIEW。Object 是持久 buffer；ContextWindow 是廉价可弃的投影。关窗口是零数据后果的*展示*操作；杀 Object 才是唯一破坏性动作。一个 Object 可被多个 view 投影。
2. **no-app / 内容即可执行（哲学盟友）**：acme/Oberon 证明「展示的内容本身就是可执行接口」。OOC 的 `method_exec`-form-as-window 已经在做——继续保护。
3. **注意力经济（统一框架）**：token 是稀缺货币。tab 过载研究（CMU）的根因是「关掉=怕丢」的黑洞效应→囤积。对应 OOC：agent 囤窗口烧 token。**解法：让折叠可证明无损，agent 才敢激进折叠**——而 buffer/view 分离**免费送**这个保证（view 折叠丢不了数据，数据在 Object 上）。

**关键 reframe**：OOC 在哲学里只有一个人机隐喻——OS 进程树（`ooc-philosophy.md:37`），且*刻意避开*桌面窗口。所以「参考人类窗口」的正确读法不是搬桌面 WM，是补上它独缺的 MVC 不变量。这要补进 `ooc-philosophy.md`：为何借 Smalltalk MVC 而非桌面 WM。

---

## 3. 目标设计

### P1（必做，纯减法）—— 让 struct 服从 glossary

`ContextWindow` 收缩成**纯投影**，不再持业务数据。**不引入「buffer」新名词**——Object 就是 buffer，glossary 已有这套词汇。

- 业务数据回到 Object（它本来就该是唯一权威）。
- `SharingState`（lent/ref + 冻结 snapshot）**整个删除**：跨 thread 共享退化成「对同一 Object 开第二个 view」，变更经 object method 路由、由 Object 自己守门。**这是最大的一笔熵减。**
- `isSelfWindow`/`isNonPersistedWindow`/`as any` 自然消失：self/peer/creator 都是普通 view，本就不持久化（因为*没有 view 作为数据被持久化*，只持久化 thread 的 view 列表）。
- **保留一处诚实让步**：snapshot（compressLevel 2）应冻结*渲染文本*，不只冻元信息——对 LLM 而言「三轮前看到的确切字节」常常才是它推理依赖的状态，磁盘可能已漂移。这是 view 唯一可以合法持有的一小片数据，正是旧 `SharingState.snapshot` 的直觉，换个地方安放。

### P2（高价值，纯减法）—— 开放窗口类型轴

杀掉 15 成员 discriminated union 和 core→builtins/extendable 的 import。

**关键区分：运行时 class registry（开放）替代编译期 discriminated union（闭合）。** per-class 的 `compressView`/render hook 不需要 union 才能分派——它本就经 `registerReadable` 注册、沿 parentClass 链查，§1 已证渲染期就是这么做的。所以**开 union 不丢类型感知折叠**（明确反驳「类型逻辑会散进各 Contributor」的担忧：逻辑留在 class 上，靠 class-id 查表分派，不靠 TS union）。新 builtin = 继承 root 的新 class，不再要求改 core。

### P3（配套）—— builtin 分类正名

在 `class` 维度显式承认三角色 + proxy（见 §1 表），五件套**按角色裁剪**：buffer-class 不必有人格 self.md（空壳是诚实的，或干脆省略），只有 agent-class 才有完整人格 + thinkloop + 实例。收尾 `ooc.type → ooc.kind/ooc.class` 的半截迁移。

---

## 4. Demo —— 理想设计长什么样

### Demo A · 数据结构 before/after

**Before**（`knowledge/types.ts` 等：一个 struct 六重身份）：

```ts
interface KnowledgeWindow extends BaseContextWindow {
  class: "knowledge";
  // ① 数据
  path: string; body: string; source: "explicit" | "protocol" | "activator" | "relation";
  // ② 视图（+ @deprecated 扁平 viewport 尾巴）
  state?: WindowDisplayState; compressLevel?: 0 | 1 | 2;
  // ④ 预算
  provenance?: ContextWindowProvenance; relevance?: ContextWindowRelevance;
  // ⑥ 共享
  sharing?: SharingState;  // 内含冻结 snapshot
  // + isSelfWindow / boundFormId / windowKnowledgePaths ...
}
```

**After**（Object 持久、View 极薄）：

```ts
// 持久 buffer：唯一权威，存一份，跨 thread 共享 = 它被多个 view 引用
interface Object {
  id: string;
  class: string;                 // 沿 parentClass 链解析 method/render/compress
  data: unknown;                 // path/body/history/steps... 业务数据只在这
}

// thread 持有的，只是一串纯投影
interface ContextView {
  objectId: string;              // 投影哪个 Object（取代被重载的 window.class=objectId）
  parentViewId?: string;
  compressLevel: 0 | 1 | 2;
  viewState?: WindowDisplayState;       // viewport/lines——纯视角参数
  frozenRender?: string;                // 仅 level=2：冻结的渲染文本（唯一让步，治漂移）
  // 没有 sharing / 没有 isSelfWindow / 没有业务数据
}
```

死掉的名字：`SharingState`、`isSelfWindow`、`isNonPersistedWindow`、`boundFormId`、base/full 双头 `ContextWindow` union、`class: objectId as any`、每个 `@deprecated` 扁平 viewport 字段。新增名词：**0 个**（Object/ContextView 都已在 glossary 里）。

### Demo B · LLM 看到的 `<context>` before/after

**Before**（忠于当前渲染，`xml.ts`）——注意 struct 债如何在渲染里冒头：

```xml
<context>
  <self object_id="supervisor"/>
  <thread id="thr_a" status="running">
    <window_classes>                          <!-- 菜单已按 class 声明一次（已修） -->
      <class name="knowledge"><method name="reload">.../><method name="close".../></class>
      <class name="talk"><method name="say".../><method name="wait".../></class>
    </window_classes>
    <context_windows>
      <!-- 自我门面窗：class= 被重载成 objectId，靠 as any 逃出 union -->
      <window id="supervisor" class="supervisor" status="active"><title>supervisor</title>...</window>
      <!-- 跨 thread 共享：从冻结 snapshot 渲染，标题贴 [ref→owner]，多一套 read_only/sharing 记账 -->
      <window id="talk_42" class="talk" status="open" read_only="true" sharing="ref" owner_thread="thr_b">
        <title>[ref → owner@thread:thr_b] 与 reviewer 讨论</title> ...
      </window>
      <window id="w_kn_1" class="knowledge" status="open"><title>readable-vs-visible</title>
        <body>...知识正文（业务数据，住在 window 里）...</body>
      </window>
    </context_windows>
  </thread>
  <context_overflow item_count="3"> <item id="w_kn_7" relevance="0.21" reason="low score"/> ... </context_overflow>
</context>
```

**After**——身份上提、view 引用 Object、共享与本地无差别：

```xml
<context>
  <self object="supervisor"/>                  <!-- 身份在这；不再有 class=objectId 的门面窗 -->
  <thread id="thr_a" status="running">
    <object_classes>                            <!-- class 声明方法契约一次；按 class-id 查表，无 TS union -->
      <class name="knowledge"><method name="reload".../><method name="close".../></class>
      <class name="talk"><method name="say".../><method name="wait".../></class>
    </object_classes>
    <views>
      <!-- 共享 = 对同一 Object 开第二个 view，渲染上与本地视图完全一致，没有 ref/snapshot/read_only -->
      <view object="talk_42" class="talk" status="open">
        <title>与 reviewer 讨论</title> ...
      </view>
      <view object="w_kn_1" class="knowledge" status="open">
        <title>readable-vs-visible</title>     <!-- 正文从 Object 解析，view 不持有 -->
        <body>...</body>
      </view>
      <!-- 折叠态：可信无损。正文在 Object 上，level=1 只剩 stub -->
      <view object="w_kn_7" class="knowledge" compress="1">
        <title>peer-window-structure</title>
        <folded>exec(object="w_kn_7", method="expand") 恢复。数据在 Object，折叠零丢失。</folded>
      </view>
    </views>
  </thread>
</context>
```

差别一眼可见：① 自我门面窗不再 `class=objectId`，身份上提到 `<self>`；② 跨 thread 共享渲染与本地视图**字节级一致**，删掉 `[ref→owner]`/`read_only`/`sharing`/snapshot 整套；③ `<context_overflow>` 的「低分驱逐」让位给「agent 主动折叠」——因为折叠现在可信无损（黑洞效应消除）。

### Demo C · 一次跨 thread 协作的机制 trace

场景：supervisor（thr_a）开 `plan P` 与 `file X` 干活，与 reviewer（thr_b）讨论 P。

```
1. exec(root, "plan", {...})        → 新建 Object P（数据在 P）；thr_a 加一个 view→P
2. exec(root, "open_file", {x})     → 新建 Object X；thr_a 加一个 view→X
3. exec(view_X, "compress")         → thr_a 的 view→X 置 compress=1。
                                      X 的数据原封不动在 Object 上。token 立降。
4. exec(root, "talk", {target:rev}) → talk Object T 建立；thr_a 与 thr_b 各自加一个 view→T
   ── reviewer 想看 P ──
5. exec(view_T, "say", {ref: P})    → 不是「借出 P / 冻 snapshot」，而是 thr_b 也加一个 view→P
                                      P 仍只存一份；rev 改 P 经 P 的 object method，P 自己守门
6. exec(view_X, "expand")           → 从 Object X 重渲染（+ 若 level 曾到 2，用 frozenRender 防漂移）
```

对照今天：第 5 步要走 `SharingState.lent_out`/`ref` + `applyInitialShare` 冻结 snapshot + `openMethodExec` 的 sharing 守门（`manager.ts:194-203`）。新模型里这一整套蒸发——**「共享」就是「开第二个 view」**，因为 Object 是唯一真相源。

### Demo D · builtin 分类 before/after

```
Before: 12 个 builtin，一张「五件套 + _builtin/<id> class」皮，ooc.type/ooc.kind 半截迁移
After:
  base class    : root            （通用动词面，人人继承）
  buffer class  : file knowledge plan program search todo skill_index
                  （无人格 self.md=诚实；不实例化；不跑 thinkloop；产 view 的类）
  agent class   : supervisor      （人格 self.md + thinkloop + objects/ 实例）
  proxy         : user            （人类占位）
  teaching      : example         （模板，不算运行角色）
```

---

## 5. 迁移现实 —— 三笔最硬的刀，与一句诚实

1. **`manager.ts` ~120 行 form 生命周期**（open→refine→submit、failed→refine 复活、outcome 归一化、`isLegacyErrorResult` 嗅探）：form-as-content 在纸面干净，但这张状态转移表是真资产，改它最容易悄悄弄坏 agent 的自我纠错 UX。
2. **`do`/`talk` 的「会话即 Object」反转**：血缘半径大，触及 `do/`、`talk/`、`reflect-request`（它是 `Omit<TalkWindow,"class">` 复用，须从 buffer/view 重新派生）。要证明无代码*透过 window struct*读会话数据、而非透过 Object。
3. **持久化切换不能孤儿化在跑的 dogfooding world**：每个已存窗口拆成（Object）+（view 记录）；knowledge 引用计数从 window-keyed 改 Object-keyed 且不能 double-free（两 thread 现在合法地各持一 view）。必须幂等可回滚。

> **一句诚实**：P1+P2 解决*类型与数据*的熵，但 `manager.ts` 80% 的复杂度是*行为性*的（form 复活、知识引用计数、do-fork 共享）。**类型统一不会自动简化它。** 别承诺减法能瘦掉 manager 的行为复杂度。

---

## 6. 落点（对象树，按 HOLD 暂不动源码）

| 内容 | 落点 |
|---|---|
| 债 1 / P3（builtin 三角色） | `children/class/self.md` + knowledge |
| 债 2 / P1（struct 服从 glossary、ContextWindow 定义） | `children/executable/` + `_shared/types/context-window.ts` 注释 |
| 债 3 / P2（开放类型轴：runtime registry vs 编译期 union） | `children/executable/knowledge/` |
| 人类窗口 reframe（借 Smalltalk MVC，非桌面 WM） | supervisor `knowledge/ooc-philosophy.md`（现仅 OS 进程树一个隐喻） |

---

## 7. 明确不做

- **tiling / slot / focus**（5 固定 slot + 单一 focus + 配额）：①加机制——slot/focus/quota 三个新名词，撞「克制熵增」红线；②与 LLM 并行注意冲突——「一次只看一个窗口」是从人类中央凹视觉借的，LLM 对整个 context 张量并行注意，强制单 focus 会饿死多对象推理（同时改 file_A+file_B 对齐一个 plan）；③有用内核（可信折叠击败囤积）已被 P1 **免费**交付，机制不必引入。多对象工作该走 `do`-fork 子 thread（各自一个工作区），不是拉宽 focus。
- **新增「buffer」名词**：Object 就是 buffer，复用现有词汇。
- **动 4 原语 / method_exec-form-as-window**：这是 OOC 跑通的优雅处，保护。
