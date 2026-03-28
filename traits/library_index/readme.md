---
when: always
description: "Library 公共资源索引，让对象知道如何查找和使用 library 中的 skills、traits 和 UI 组件"
---

# Library 公共资源库

OOC 系统有一个公共资源库（library 对象），存放所有对象可复用的资源。

## 资源类型

| 类型 | 位置 | 用途 |
|------|------|------|
| Skills | `library/skills/` | 结构化 prompt 模板，定义特定领域能力 |
| Traits | `library/traits/` | 公共 trait，自动加载到所有对象 |
| UI Components | `library/ui-components/` | 公用 React 组件 |

## 如何使用

### 查找可用 Skill

调用 `listLibrarySkills()` 获取所有可用 skill 的列表。

### 读取 Skill 内容

调用 `readLibrarySkill("skill-name")` 读取指定 skill 的完整内容。skill 名称不需要 `.md` 后缀。

### 查找可用 Trait

调用 `listLibraryTraits()` 获取所有公共 trait 的列表。

注意：library 中的 trait 会自动加载到你的能力列表中，不需要手动引用。

### 搜索资源

调用 `searchLibrary("关键词")` 在所有资源中搜索匹配的内容。

## 示例

```javascript
// 查看有哪些 skill 可用
const skills = listLibrarySkills();

// 读取 deep-reading skill 的内容
const content = readLibrarySkill("deep-reading");

// 搜索与"新闻"相关的资源
const results = searchLibrary("新闻");
```
