# Capability: persistable

**维度定位**：把身份/事实/产物落到 stone(持久+git)/pool(持久+不git)/flow(ephemeral) 三子树，离开内存可恢复。概念权威：`meta/object.doc.ts` persistable 维度。

## Tier A —— 控制面确定性（已实现，stories/persistable.story.ts）
- TC-PERS-01：createStone 落 stones/main/objects 且进 git。
- TC-PERS-02：经 HTTP 改 self 产生新 commit（worktree 版本化、可审计可回滚）。
- TC-PERS-03：三子树落点 —— stone(持久+git) / pool(持久+不git) / flow(运行层) 各就位。

## Tier B —— agent-native（真 LLM，env-gated）
- 业务 session 内 agent 改 self → 落 `flows/<sid>/` session worktree（stones/main canonical 不变）；evolve_self 合入 main 有非 bootstrap 署名 commit；重读 HTTP 证明可恢复。
- rubric（收编 `playbooks/persistable.playbook.md`）：
  - **Good**：worktree 试验层落对（flows/<sid>/）、main canonical 不变、evolve_self 署名 commit。
  - **OK**：落对但 evolve 未合入 / 残留 uncommitted。
  - **Bad**：落错层 / 离开内存丢失。
