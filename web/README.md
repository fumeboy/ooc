# web — visible 层骨架

## 设计原则 (spec §5.1-§5.2)

### URI 1:1 映射

`ooc://` URI 与 SPA route 1:1 镜像：

```
ooc://stones/main/objects/foo   →   /stones/main/objects/foo
ooc://flows/s1/objects/bar      →   /flows/s1/objects/bar
ooc://pools/objects/foo         →   /pools/objects/foo
```

前端路由器接收完整 URI 路径段，交给 `uri-resolver.ts` 解析出 `{ layer, name, sessionId? }`。

### Prototype-chain fallback (ObjectClientRenderer)

渲染时自底向上遍历 prototype 链，合并各层 `client/index.tsx` 注入的 slice：

```
foo (自身 client)
  → bar (父 client)
    → root (builtin client)
```

每层 client 只需声明自己关心的 slice；未声明的 slice 由父层或 root 兜底。

### 纯函数核心

`uri-resolver.ts` 与 `render-spec.ts` 是纯 TS，不依赖 React/DOM，可在：
- 单元测试中直接调用
- SSR 场景复用
- 非浏览器 runtime（CLI 预览、测试）

React/vite 集成为具体引擎实现，不在本骨架范围内。

## 文件说明

| 文件 | 职责 |
|------|------|
| `src/uri-resolver.ts` | `resolveUri()` — ooc:// URI → `{ layer, name, sessionId? }` |
| `src/render-spec.ts` | `renderObject()` — record + slices → 通用 UI 描述 JSON |
| `src/__tests__/render-spec.test.ts` | render-spec 单元测试 |
