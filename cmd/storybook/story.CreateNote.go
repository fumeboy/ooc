package main

import "time"

var CreateNote = Story{
	Name:        "CreateNote",
	Description: "创建笔记",
	Request:     "请帮我创建一条笔记，标题是'今日计划'，内容是'完成项目文档'",
	MaxWait:     60 * time.Second,
}

func init() {
	stories["CreateNote"] = &CreateNote
}
