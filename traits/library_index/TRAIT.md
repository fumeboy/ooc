---
name: kernel/library_index
type: how_to_use_tool
version: 1.0.0
when: never
command_binding:
  commands: ["program"]
description: Library 公共资源索引，让对象知道如何查找和使用 library 中的 traits 和 UI 组件
deps: []
---
# Library 公共资源库

OOC 系统有一个公共资源库（library 对象），存放所有对象可复用的资源。

## 资源类型

| 类型 | 位置 | 用途 |
|------|------|------|
| Traits | `library/traits/` | 公共能力定义，按需读取和激活 |
| UI Components | `library/ui-components/` | 公用 React 组件 |

**注意**：`library/skills/` 目录已废弃，所有 skill 已合并为 trait 格式，统一存放在 `library/traits/` 下。

---

## 核心概念

### Skill 与 Trait 合并

原有的 skill 和 trait 概念已统一为 trait：

| 原概念 | 新概念 | 说明 |
|--------|--------|------|
| Skill (`library/skills/*.md`) | Trait (`library/traits/{name}/readme.md`) | 单文件 markdown 模板 → 目录结构，默认 `when: never` |
| Trait (`library/traits/{name}/`) | Trait | 保持不变 |

### 激活策略（when 字段）

`when` 字段决定 trait 的激活方式，支持以下三种形式：

| 值 | 含义 | 示例 |
|----|------|------|
| `"always"` | 始终激活，自动注入 context | `when: always` |
| `"never"` | 不自动激活，需手动 `activateTrait()` | `when: never` |
| 自然语言描述 | 条件激活，需出现在作用域链中才激活 | `when: "用户需要搜索时"` / `when: "处理新闻内容"` |

**从 skill 转换来的 trait 默认 `when: never`**，你可以根据需要修改为其他值。

### 两段式方法调用

Trait 中的方法支持两种调用方式：

| 方式 | 语法 | 说明 |
|------|------|------|
| 两段式（推荐） | `traitName.methodName(args)` | 明确指定方法所属的 trait |
| 扁平式（兼容） | `methodName(args)` | 向后兼容，可能产生命名冲突 |

**推荐使用两段式调用**，避免不同 trait 之间的方法名冲突。

---

## 如何使用

### 查看可用的公共 Trait

调用 `listLibraryTraits()` 获取所有公共 trait 的名称列表。

### 读取 Trait 内容

调用 `readTrait("trait-name")` 读取指定 trait 的内容。

**返回值**：
```typescript
{
  name: string,        // trait 名称
  readme: string,      // readme.md 正文内容
  when: string,        // 激活条件（always/never/自然语言）
  source: string       // 来源位置（self/library/kernel）
}
```

**搜索优先级**：`readTrait` 按以下顺序查找：
1. 对象自身 `stones/{name}/traits/`
2. 公共库 `library/traits/`
3. 内核 `kernel/traits/`

### 激活 Trait

调用 `activateTrait("trait-name")` 将 trait 激活到当前栈帧。激活后：
- trait 的 readme 内容会注入到 Context 中
- 如果 trait 有 `index.ts`，其中的方法可通过两段式调用：`traitName.methodName(args)`

**注意**：激活的 trait 只在当前栈帧有效，当 focus 离开当前节点时自动失效。

### 调用 Trait 中的方法

假设 `git_ops` trait 有一个 `commit` 方法：

```javascript
// 两段式调用（推荐）
git_ops.commit("feat: add new feature", "完善用户认证功能");

// 扁平式调用（兼容）
commit("feat: add new feature", "完善用户认证功能");
```

### 搜索资源

调用 `searchLibrary("关键词")` 在所有公共 traits 中搜索匹配的内容。

---

## 维护你自己的 Traits 索引（可选约定）

你可以在自己的 `traits/traits_index/readme.md` 中维护一个索引，记录你感兴趣的公共 traits：

```markdown
# 我的 Traits 索引

## 常用 Traits

| 名称 | 描述 | 使用场景 |
|------|------|----------|
| news-aggregator | 新闻聚合 | 每日早报、科技动态 |
| deep-reading | 深度阅读 | 分析文章、提取洞见 |
| prd-assistant | PRD 助手 | 编写产品需求文档 |

## 如何使用

1. `readTrait("news-aggregator")` 查看内容
2. `activateTrait("news-aggregator")` 激活使用
3. `news_aggregator.someMethod()` 调用方法
```

这只是一个使用约定，系统不会自动读取这个文件。你需要自己决定何时读取和激活哪些 trait。

---

## 示例

```javascript
// 查看有哪些公共 trait 可用
const traits = listLibraryTraits();

// 读取 news-aggregator trait 的内容
const info = readTrait("news-aggregator");
console.log(info.readme);  // 查看完整内容
console.log(info.when);    // 查看激活条件
console.log(info.source);  // 查看来源位置

// 激活到当前栈帧
activateTrait("news-aggregator");

// 调用 trait 中的方法（两段式）
news_aggregator.fetchNews("tech");

// 搜索与"新闻"相关的资源
const results = searchLibrary("新闻");
```

---

## 与旧 API 的兼容

以下 API 仍可使用，但建议迁移到新的统一 API：

| 旧 API | 新 API | 说明 |
|--------|--------|------|
| `listLibrarySkills()` | `listLibraryTraits()` | skills 已合并到 traits |
| `readLibrarySkill(name)` | `readTrait(name)` | 统一使用 readTrait |
| `listLibraryTraits()` | `listLibraryTraits()` | 保持不变 |
| `searchLibrary(keyword)` | `searchLibrary(keyword)` | 保持不变 |

**API 变更**：
- `readTrait()` 不再返回 `code` 字段（index.ts 源码）
- 新增两段式方法调用：`traitName.methodName()`
