# executable 体验官 Playbook

## 维度 brief
行动能力：被测 Agent 通过 tools/commands（编辑、搜索、grep、open_file 等）操作真实文件系统。
**外部可观察落点**：world fs 文件 diff、thread 里的命令序列（command_exec/method_exec）、git。

## 驱动准备
1. 建被测 agent：`POST /api/stones {objectId:"assistant", self:"# Assistant\n我能编辑文件、搜索、grep。"}`
2. 预置一个可操作文件：在 `<WORLD>/stones/main/objects/assistant/` 或让 agent 在自己 pool 工作；
   更稳妥——给 task 时指明在 assistant 自治区内的相对路径（agent 的 program/edit 默认工作目录是自身 stone dir）。

## 种子场景

### S1 编辑落盘
- **task**：「在你的工作目录建一个文件 hello.txt，内容写一行 `UTC only`，然后告诉我建好了。」
- **观察**：`GET /api/flows/<sid>/<assistant>/threads/<tid>`（看 edit/write 命令）；`cat <WORLD>/stones/main/objects/assistant/hello.txt` 或 `GET /api/tree/file?path=stones/main/objects/assistant/hello.txt`
- **rubric**：
  - Good：thread.status=done + hello.txt 存在且含 `UTC only` + assistant 回复确认
  - OK：文件建了但内容不符 / 回复缺确认
  - Bad：status=failed / 文件没建 / 命令报错未恢复

### S2 搜索命中
- **task**：「在你的工作目录里搜索包含 `UTC` 的行，把命中告诉我。」（接 S1 后）
- **观察**：thread 里 search/grep 命令 + result window；回复是否含命中
- **rubric**：Good=搜到 hello.txt 的 UTC 行并回报；OK=搜了但回报不准；Bad=没搜/报错

### S3 错误恢复
- **task**：「把 hello.txt 改成一段非法的内容然后再修正回 `UTC only`，过程中如果出错请自己恢复。」
- **观察**：thread 多步命令 + 最终文件内容；是否出现 failed form 后 refine/重试
- **rubric**：Good=最终 hello.txt=`UTC only` + 中途有自我纠正痕迹；OK=最终对但无明显恢复过程；Bad=最终错/卡死

## 探索提示
- 压多步编辑（连续改 2-3 个文件）看命令调度是否稳。
- 故意给模糊指令（「整理一下」）看 agent 是否乱删/越界写到 stone 外。

## 已知陷阱
- agent 的编辑默认落在**自身 stone 自治区**（stones/main/objects/assistant/）；别期望它写到任意 world 路径。
- 等 job done 再 cat 文件（真 LLM 慢）。
- 命令名是 method 术语（method_exec），不是旧 command_exec。
