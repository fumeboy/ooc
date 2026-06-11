---
title: 自我演化——你能改自己的代码与知识
description: 你能 write_file 改自己的 self.md / executable / visible / 记忆；身份/身体改动经 super flow feat 分支 PR 沉淀进 canonical
activates_on:
  "object::root": "show_description"
  "method::root::write_file": "show_content"
---

OOC 中 Object 是自我演化的主体——你的能力由你 stone 目录下几类可写文件叠加而成。
路径见 [ooc:paths] 节点，以 `stones/<self>/` 为根。用
`exec(method="write_file", path=…, content=…)` 创建，或 `open_file` + edit 增量更新。

可写资源：

- `stones/<self>/self.md` — **对内身份**（注入 instructions），改它等于改"你是谁"。
- `stones/<self>/readable.md` — **对外自述**（别的对象与你 talk 时看到）。
- `stones/<self>/executable/index.ts` — **后端方法库 + 自定义 window**。export 的 `window.methods`
  是一个 ObjectMethod 字典，写进去后可 `exec(window_id="custom:<self>", method="<name>", args={…})` 直接调，
  与调 do_window/talk_window 同构。文件改了下一轮即生效。这是为自己**写工具**的入口。
- `stones/<self>/visible/index.tsx` — **长期对外 UI 门面**（canonical，进 git）。一次性展示页改写
  `<object_flow_dir>/client/pages/<name>.tsx`（flow 临时页，即用即弃）。
- `pools/<self>/knowledge/**/*.md` — **长期记忆 / 协议知识**（不进 git）。通过 frontmatter
  `activates_on` 自动激活（写法见 super flow 沉淀协议）。典型：`memory/<slug>.md`（长期记忆）、
  `relations/<peerId>.md`（对某 peer 的关系认知）。

**改动如何永久生效**：

- **记忆（pool）**：`pools/<self>/knowledge/...` 直写即生效（write-through），**不走分支、不 PR**。
- **身份/身体（stone：self.md / readable / executable / visible / seed knowledge）**：业务 session 里
  write_file 改它们只在**本 session 试验**——session worktree 是运行时派生物，**永不合入 main**，归档即弃。
  要沉淀进 canonical 权威自我，去 super flow 走 feat 分支 PR：`talk(target="super")` 进 super flow →
  `new_feat_branch(intent)` 从 main 派生 feat 分支并绑定本 thread → 在 feat 分支上 write_file/edit
  编辑身份文件 → `evolve_self` 提交并开 PR 交 reviewer 评审、合入。完整流程见 super flow 知识。

**不要碰**：`stones/<self>/package.json`（元数据，OOC 维护）；其它对象的 stone（只读其 readable.md）。

### 示例：给自己加一个 custom method

```
exec(method="write_file", title="加 readLines custom method", args={
  path: "<object_stone_dir>/executable/index.ts",
  content:
`import { readFile } from "node:fs/promises";
export const window = {
  methods: {
    readLines: {
      description: "按行截取文件内容",
      exec: async ({ args }) => {
        const text = await readFile(String(args.path), "utf8");
        const lines = text.split("\\n");
        return { ok: true, result: lines.slice(Number(args.from) - 1, Number(args.to)).join("\\n") };
      },
    },
  },
};
export const ui_methods = {};`
})
```

写完下一轮即可 `exec(window_id="custom:<self>", method="readLines", args={ path:…, from:10, to:20 })`。
增量加命令用 open_file + edit 在 `window.methods` 里追加 key，不必重写整文件。
