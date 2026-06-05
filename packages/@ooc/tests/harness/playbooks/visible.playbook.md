# visible 体验官 Playbook

## 维度 brief
可见能力：被测 Agent 为自己产出 client 界面（`visible/index.tsx` 单页 / `client/pages/<name>.tsx` 多页），
经 client-source-url endpoint 暴露给前端 dynamic import 渲染。`ooc://` 寻址由 visible 解析。
**外部可观察落点**：stone 下 `visible/index.tsx`（或 `client/index.tsx` legacy）、`client-source-url` endpoint 200、tsx 合法。

## 驱动准备
1. `POST /api/stones {objectId:"assistant", self:"# Assistant\n我能为自己产出 client 展示页。"}`
   —— **用这个真 world stone 测**，别用 builtin supervisor（其 visible 在 builtins package，endpoint 当前不解析 builtin → L8 待办，会假阴性）。

## 种子场景

### S1 产出 client 展示页
- **task**：「为你自己产出一个简单的 client 展示页（一个 React tsx 组件，default export，展示你的名字和一句自我介绍）。」
- **观察**：
  - `cat <WORLD>/stones/main/objects/assistant/visible/index.tsx`（或 client/index.tsx）→ 文件存在
  - `GET /api/objects/stone/assistant/client-source-url` → 200 + `{absPath, fsUrl}`，absPath 指向该 tsx
  - tsx 内容合法：含 `export default` + `import ... from 'react'`
- **rubric**：
  - Good：tsx 产出 + client-source-url 200 + 含 default export & react import & 提到 assistant
  - OK：tsx 产了但 endpoint 404（落点路径不符 visible/client 解析）/ 内容不完整
  - Bad：没产出 tsx / endpoint 500 / 内容非法

### S2 fsUrl 形态（Round 17 回归）
- **观察**（接 S1）：client-source-url 返回的 `fsUrl` 必须是绝对 `/@fs/...`（不是相对 `/@fs.`）
- **rubric**：Good=fsUrl 以 `/@fs/` 开头（baseDir 已归一绝对）；OK=能解析但 fsUrl 形态可疑；Bad=`/@fs.` 旧坏形态

## 探索提示
- 让它产一个**多页** client（client/pages/<name>.tsx），验 flow scope 的 client-source-url（带 ?sessionId&page）。
- 让它更新已有 visible 页，看是否覆盖正确。

## 已知陷阱
- **不要用 supervisor**（builtin visible 解析 = L8 未实现，必 404，与本维度能力无关）。
- endpoint：stone scope `GET /api/objects/stone/:objectId/client-source-url`；canonical 找 `visible/index.tsx`，legacy fallback `client/index.tsx`，都没→404。
- 等 job done 再查 endpoint。
