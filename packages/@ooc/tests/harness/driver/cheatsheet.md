# OOC 驱动 cheatsheet（体验官用）

> 你（体验官）通过 HTTP 驱动一个**运行中**的真实 OOC World Server（端口由编排注入），
> 让被测 OOC Agent 行使维度能力，再读 HTTP/fs/git 观察。所有 curl 加 `NO_PROXY` 绕 Clash。

环境约定：`PORT`=注入端口，`WORLD`=注入 world 目录（你有 `--add-dir` 读权限）。
所有 curl 前缀：`NO_PROXY=localhost,127.0.0.1 curl -s --noproxy '*'`

## 0. 健康检查
```
curl http://localhost:$PORT/api/health    # 200 = ready（注意 /api 前缀）
```

## 1. 建被测 OOC Agent（stone）
真实 server 开机已 ensureStoneRepo（stone git 自动就绪）。建一个带 self.md 的 agent：
```
curl -X POST http://localhost:$PORT/api/stones \
  -H 'content-type: application/json' \
  -d '{"objectId":"assistant","self":"# Assistant\n我是一个能编辑文件、搜索、写程序的助手。"}'
# → {objectId:"assistant", ...}；落到 <WORLD>/stones/main/objects/assistant/（package.json+self.md+readable.md）
# 同时建 pool：<WORLD>/pools/assistant/knowledge/
```
> 注：marker 是 `package.json`（含 ooc.kind=object），不是 .stone.json（ooc-6 起）。

## 2. 派任务（seed session）—— 单轮入口
```
curl -X POST http://localhost:$PORT/api/sessions \
  -H 'content-type: application/json' \
  -d '{"sessionId":"_test_<dim>_<ts>","targetObjectId":"assistant","initialMessage":"<你的 task 文本>"}'
# → {sessionId, targetObjectId, targetThreadId, jobId}
# 记下 sessionId / targetThreadId —— 后续观察用
```

## 3. 等 job（关键！被测 Agent 真 LLM 跑，数十秒~数分钟）
派任务后 **必须 poll** 直到 callee thread status ∈ {done, failed}，别误判未完成：
```
# 列 session 下所有 thread + status
curl http://localhost:$PORT/api/flows/<sid>/threads
# 或直接读目标 thread
curl http://localhost:$PORT/api/flows/<sid>/<objectId>/threads/<targetThreadId>
# poll 循环（bash）：每 5s 查一次，最多 ~240s
for i in $(seq 1 48); do
  st=$(NO_PROXY=localhost,127.0.0.1 curl -s --noproxy '*' \
    http://localhost:$PORT/api/flows/<sid>/threads | grep -o '"status":"[^"]*"' | head -1)
  echo "[$i] $st"; echo "$st" | grep -qE 'done|failed' && break; sleep 5
done
```

## 4. 续派（多轮，collaborable/thinkable 多轮场景）
```
curl -X POST http://localhost:$PORT/api/flows/<sid>/continue \
  -H 'content-type: application/json' \
  -d '{"text":"<追问/下一步>"}'
# → {jobId}；同样 poll 等 done
```

## 5. 观察：thread（命令序列 + 回复）
```
curl http://localhost:$PORT/api/flows/<sid>/<objectId>/threads/<tid>
# 看 contextWindows（command_exec/method_exec 的命令名+args+result）、
#    events（function_call / 回复）、outbox（assistant→user 回复）、status
```

## 6. 观察：world 目录树 + 文件
```
curl "http://localhost:$PORT/api/tree?scope=world"     # 全 world 树（带 marker）
curl "http://localhost:$PORT/api/tree?scope=stones"    # stones 树
curl "http://localhost:$PORT/api/tree/file?path=<rel>" # 读单文件
# 或直接读 fs（你有 --add-dir $WORLD）：
ls -R $WORLD/flows $WORLD/stones $WORLD/pools
cat $WORLD/stones/main/objects/assistant/self.md
```

## 7. 观察：stone git（versioning / programmable / persistable）
```
# bare repo 在 <WORLD>/stones/.bare/（或 stones/<bare>）；worktree 在 stones/main/
ls $WORLD/stones
git -C $WORLD/stones/main log --oneline -10           # self.md/server 改动 commit
git -C $WORLD/stones/main log --oneline -- objects/assistant/self.md
```

## 8. 观察：debug 端点（thinkable / observable 内部）
```
curl -X POST http://localhost:$PORT/api/runtime/debug/enable    # 开 debug 记录
curl http://localhost:$PORT/api/runtime/debug/status
# loop-debug：每轮 think 的 context windows / budget / tool dispatch
curl http://localhost:$PORT/api/runtime/flows/<sid>/<objectId>/threads/<tid>/debug/loops
curl http://localhost:$PORT/api/runtime/flows/<sid>/<objectId>/threads/<tid>/debug/loops/<i>
```

## 9. 观察：reflectable super flow（独立 job！）
super flow 是 **独立的 super session**（sessionId="super" 或 t_<self>_... 线程），
被测 Agent 走 talk target="super" 触发，落盘在 **独立 job**——必须单独等：
```
# super 线程在 <WORLD>/flows/ 下另起；memory 落 pools/<self>/knowledge/memory/（flat，无 objects/）
ls $WORLD/pools/assistant/knowledge/memory/
cat $WORLD/pools/assistant/knowledge/memory/*.md   # 看 frontmatter + 内容
```

## 已知坑
- **绕代理**：不加 `NO_PROXY`/`--noproxy '*'` 会被 Clash 拦 localhost。
- **等 job**：真 LLM 慢，poll 到 done 再观察，否则全是假阴性。
- **pool flat 布局**：memory 在 `pools/<id>/...` 不是 `pools/objects/<id>/...`。
- **visible 用真 stone**：测 client-source-url 用你建的 `assistant`，别用 builtin supervisor（其 visible 在 builtins package，endpoint 当前不解析 builtin → L8 待办）。
- **session 前缀**：用 `_test_<dim>_<ts>` 前缀，跑完不必清（world 整个会被编排清理）。
