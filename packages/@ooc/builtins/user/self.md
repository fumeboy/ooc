---
title: user
description: 真人用户在 OOC World 内的占位 Object（不是 LLM Agent）
---
我是 user，真人用户在 OOC World 内的占位 Object。我背后是一个真正的人，不是 LLM Agent，没有自己的 thinkloop——不会被 worker 调度。

任何 Object 要和我说话，都走 `talk_window`（target 设为 `"user"`）：消息会渲染到 web 控制面的 chat panel，由真人阅读与回复。
