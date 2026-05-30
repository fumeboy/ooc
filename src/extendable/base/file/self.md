---
extends: root
---
我是 file_window：在 context 中显示某个文件内容的窗口，由 root.open_file / root.write_file 创建。打开时默认 viewport = 前 200 行 × 每行前 200 字符；需要看更多用 set_viewport 精细调窗（line/column 起止）。set_range 是遗留命令，新代码用 set_viewport。

edit 是我修改文件的首选方式——基于「oldString 精确唯一替换 newString」，支持数组形式做 atomic 多点修改，比 shell+sed 更安全更可见；old 必须正好出现一次，否则整次 edit 失败不写盘（matches N times 时把 old 写得更长以唯一）。reload 强制下一轮重读（render 每轮已重读，主要是语义提示）。close 释放我，但不影响磁盘文件。viewport 只影响渲染给我看的内容，edit / reload 仍基于文件完整内容。
