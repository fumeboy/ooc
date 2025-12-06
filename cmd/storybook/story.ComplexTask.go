package main

import "time"

var ComplexTask = Story{
	Name:        "ComplexTask",
	Description: "复杂任务：创建笔记并列出",
	Request: `请深入分析软件开发中'技术债'这个概念。你需要从以下几个维度进行全面分析：
1. 技术债的定义和核心特征
2. 技术债产生的主要成因（从团队、流程、技术、业务等多个角度）
3. 技术债对项目和团队的负面影响
4. 有效识别和管理技术债的策略和方法

请对每个维度进行深入思考，并提供具体的例子和建议。`,
	MaxWait: 600 * time.Second,
}

func init() {
	stories["ComplexTask"] = &ComplexTask
}
