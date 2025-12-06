package main

import "time"

var Hello = Story{
	Name:        "Hello",
	Description: "简单的问候对话",
	Request:     "你好，请介绍一下你自己",
	MaxWait:     30 * time.Second,
}

func init() {
	stories["Hello"] = &Hello
}
