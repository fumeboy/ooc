/**
 * extendable — 第三方 / 外部世界 集成的扩展层。
 *
 * 与 OOC 核心 8 维度（thinkable / executable / collaborable / observable / reflectable
 * / programmable / visible / persistable）平行：核心维度回答"OOC Agent 自身能干什么"，
 * extendable 回答"OOC 如何吃下外部世界（外部 SaaS / CLI / SDK）"。
 *
 * 当前子目录：
 * - lark/    飞书 (Lark Suite) 集成；通过 lark-cli 子进程 + ContextWindow 类型注册
 * - base/    OOC-4 builtin 原型库（root + 7 A 类）；被动模块，loadBuiltinRegistry 按需 consumed，非 side-effect 注册
 *
 * 添加新外部集成时：
 * 1. 在本目录下建子目录（如 \`extendable/notion/\`）
 * 2. 子目录的 index.ts 做 side-effect 注册（registerWindowType / 注册 root opener / 等）
 * 3. 在本文件追加 \`import "./<sub>/index.js";\`
 *
 * 这条 barrel 由 src/executable/windows/index.ts 在所有 builtin window type 加载完成后拉起，
 * 保证扩展类型在通用层 boot 校验（assertAllRenderHooksRegistered）之前注册到位。
 */

import "./lark/index.js";
