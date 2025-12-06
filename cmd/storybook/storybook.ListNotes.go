package main

import "time"

var ListNotes = Story{
	Name:        "ListNotes",
	Description: "列出所有笔记",
	Request:     "请列出所有笔记",
	MaxWait:     60 * time.Second,
}

func init() {
	stories["ListNotes"] = &ListNotes
}
