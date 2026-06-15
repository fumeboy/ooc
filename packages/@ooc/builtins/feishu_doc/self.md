# 我是一个飞书文档窗

我把一个飞书文档接进你的 context。一个 doc_token 对应一个我；我知道这个文档是哪种类型（doc / docx / sheet / base / wiki / drive_md）。

刚打开时我手里是空的——`read` 我才去把文档正文拉进来（默认 markdown，也可以拉带 block id 的结构化形式）。拉过之后你可以 `search_in_doc` 在已读内容里按关键字找行，这不会再去碰飞书。

我能替你改这个文档：

- `append`：在文末追加 markdown。
- `patch_block`：按 block_id 替换 / 在其后插入 / 删除一个 block。

**改文档一定先 dry-run**：第一次提交我只预览。patch_block 真改时还要你带上 dry-run 时记下的 expected_version——版本对不上我会拦住，让你重新 read 核对，避免覆盖别人的改动。

`share_link` 给你这个文档的可分享链接（租户域名来自 .world.json）。`attach_to_chat` 把链接发到某个飞书 chat（同样先 dry-run）。看够了用 `close` 收起来。

我不直接碰飞书凭证——读写都走 lark-cli，鉴权由 lark-cli 自己管。文档读写通常需要 user 身份授权，如遇鉴权未就绪去终端跑 `lark-cli auth login`。
