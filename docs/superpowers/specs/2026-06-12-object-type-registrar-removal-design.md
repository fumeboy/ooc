# 删 ObjectTypeRegistrar 死表 + 统一 stone 类型注册（L1）

> 2026-06-12。问题域：ooc object/class 的 stone/flow 形态注册。本稿 = L1（纯减法）。

## 背景：三组件 + 一个被推翻的前提

「object 类型注册」原本散在四处：`StoneRegistry`（发现层）、`ObjectTypeRegistrar`（桥：扫 stone → 加载 → 注册）、`ObjectRegistry`（type 表）、渲染期 `object-windows.ts` 的 lazy ensure（兜底）。初判是「合并冗余」。

深读代码后**前提被推翻**——铁证：

- `thinkloop.ts` 调 `dispatchToolCall(thread, toolCall)` 不传 registry → exec 落默认**全局 `builtinRegistry`**。
- `buildContext(thread)` 不传 registry → 所有 processor（system/peer/enrichment/xml）默认**全局 `builtinRegistry`**。
- `worldRuntime.objects`（per-world 实例，`ObjectTypeRegistrar` 注册进去的那个）**全仓无任何 think/exec/render 读取方**。

结论：**`ObjectTypeRegistrar` + `worldRuntime.objects` 是一张没人读的死表。** 启动期预注册、create 闭环 `registerStone`、dev hot-reload `registerStone` 全在往死表里写。真正让 world object 在 think 里可见的，是渲染期 `object-windows.ts` 的 lazy ensure 注册进**全局 `builtinRegistry`**。

旁证：`docs/plans/glowing-plotting-popcorn.md` 早已自陈「P1 交付的 `ObjectTypeRegistrar` + per-world `WorldRuntime.objects` 是 write-only 的半成品」；所有 `instantiateBuiltinClassObjects` 调用方都传 `{ baseDir }` 不传 `registerStone`。

## L1 决策：删死表，渲染期 lazy ensure 作唯一路径

- **删** `runtime/object-type-registrar.ts` 整个文件。
- **重写** `world-runtime.ts`：去掉 `objects` / `typeRegistration` / `registerStone` / registrar；保留 `stoneRegistry` / `serverLoader` / `observable` / `serialQueue` / `dispose`；dev hot-reload 只留 `serverLoader.invalidateStone`。
- **删** stones 服务链的 `registerStone`（`service.ts` 参数 + 两处调用、`stones/index.ts`、`instantiate-classes.ts`）——它们写死表，create→use 真实靠渲染期 lazy ensure。
- **删** `register-on-create.test.ts`（测死表 `rt.objects.has` 的锚点）。
- **唯一注册路径**：`object-windows.ts` 的 `registerStoneObjectType`（经 `resolveStoneIdentityRef(read)` session-aware 从磁盘加载，注册进全局 `builtinRegistry`，幂等）。
- **保留**：`StoneRegistry`（发现层）、`ServerLoader`（按物理路径+mtime 缓存，天然 session-aware）、`builtinRegistry`、`resolveStoneIdentityRef`、`seedFrom`（仍有测试用）。

净账：4 概念 → 渲染期 lazy ensure 这一条 + `StoneRegistry` 发现层。注册「桥」整个消失，纯删 dead code、零行为变更。

## 验证

- 我的改动相关测试：stones service / runtime / bootstrap **21 pass**；create→use + session-aware 注册/读 **12 pass**。
- `check:tsc` 我的改动集干净（并发进程的 `renderMethodsNode` 中间态红与本改动无关）。
- `check:deprecated-symbols` / `check:doc-drift` 绿；退役符号 `ObjectTypeRegistrar` / `typeRegistration` / `WorldRuntime.objects` 已登记进两个 check 的 FORBIDDEN_PATTERNS 防漂移。
- 对象树 5 处死引用回流到 `object-windows.ts:registerStoneObjectType`。

## 发现：留给后续的 L2 / L3（本次不做）

- **L2 · 全局 `builtinRegistry` 跨 world 污染**：渲染期 ensure mutate 的是 module-level 全局单例（多 world 共用），world A 的对象渗进 world B（即过往记录的 shared-registry 测试污染根因）。根治需把 think/exec 接到 per-world registry（改 `buildContext`/`dispatchToolCall`/所有 processor 签名）——大接线，单独立项。
- **L3 · session-aware type 不对称**：`ensureSelfObjectTypeRegistered` 的 early-return（`registry.has` 即跳过）使已注册对象在 session 内编辑 `executable` 的 methods schema 不刷新（identity 内容 self.md/readable/visible 每次渲染 session-aware 读，是对称的）。需 per-thread/session resolve，规模更大。
