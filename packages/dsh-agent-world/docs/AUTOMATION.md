# 自动化轮次任务（存档）

> **状态：已暂停（2026-10-20，用户要求）。**
> DSH 的定时任务只有"已调度/已删除"两种状态，没有"暂停"——所以暂停 = **删掉任务**。
> 为了将来能原样恢复，完整指令存在这里。**恢复时照抄下面的 prompt 即可。**

## 元信息

| 项 | 值 |
|---|---|
| 原任务 id | `schedule-dcd11b0a-9020-48d5-831b-6c2e07649485` |
| 标题 | `dsh-agent-world 轮次执行` |
| 间隔 | `everySeconds: 7200`（每 2 小时） |
| 投递方式 | `host` |
| 首次创建 | 2026-10-18（R117），中间被删过一次又重建，因本轮要求再次停用 |

## 恢复方式

```
schedule_create({
  title: "dsh-agent-world 轮次执行",
  every_seconds: 7200,
  prompt: <下面 fenced 块里的全文>
})
```

## 指令全文（原样保存，恢复时不要改写）

```text
【dsh-agent-world · 2 小时轮次】按 packages/dsh-agent-world/docs/PLAN-game-agent.md 的「五、轮次计划」执行下一轮。

## 步骤
1. 先 `team_task_list` 对一遍计划表（**表与任务板不一致以任务板为准**，先改对表再取活）；再读 `docs/PROGRESS.md` 最上面一条，取**第一个未完成**的轮次；依赖没满足就跳过并记下理由。**表上没有未完成项时**：不要硬造活，读 `docs/BACKLOG.md` 与 PROGRESS 里的"后续项"，挑一件最有价值的补进表再做；实在没有就只做健康检查（宿主 200、测试全绿、推送同步）并记一条简短 PROGRESS。
2. 按条目的「谁」指派成员；你是 Leader，负责拆活、监督、验收。没人可派就自己做。
3. 一轮只做 1 件（最多 2 件）可验收的事：代码+测试，或文档+决策。
4. **不要问用户问题**。遇分叉自己拍板，理由写进 PROGRESS。
5. 收尾：`node --check` → `scripts/copy-web.mjs` → `diff -rq web lib/web`（必须无输出）→ `npx tsc -p tsconfig.json --noEmit` → `node --test test/`。
6. 真机优先（3080 + `__agentWorld*`）。改了 `src/` 必须重启宿主；**宿主由 Lead 的后台任务持有**，子代理不要自己起（会随子代理退出）。
7. 写 PROGRESS，勾计划表。**只提交本轮改动的文件**（别把别人在途的半成品带进去）；`lib/` 是构建产物、已 gitignore。

## 纪律（真机踩出来的，详见 `docs/ARCHITECTURE.md` §13）
- 并行 Agent 常改 `web/scene/scene-phaser.js`、`web/main.js`、`web/index.html`、`web/styles/layout.css`：先看 mtime、先 read、`FS_STALE_VERSION` 就重读。
- 验收走真实用户路径；对接外部事件流的逻辑要用**真实会话序列做回放测试**。
- 先问"这个指标测的是不是我要判的东西"；`getComputedStyle` 读的是**声明**不是**呈现**（opacity、transform 都骗过我们）。
- 测试钉关系不钉数值，每次改判据配反证。
- 归零判据连注释一起算；故障注入恢复放 `try/finally`；崩溃通知不是验收结论。
- 新增 web 文件先 `curl` 探 404（profile 硬链可能缺）。
- 推送走 HTTPS：`git push https://github.com/kp-z/dsh-dev-git-graph.git feat/dsh-agent-world:feat/dsh-agent-world`；GitHub 常单独不通，失败就留到下轮再推。
- 状态色不当文字；`opacity` 不做弱化。

## 产品红线
- 参考 Godot 原版，墙/桌/椅/黑板是实体、参与 Y 排序。
- 配色是内容（D31），JS 里不写字面十六进制。
- UI 主题「夜班办公室」（R115），改样式先读 `web/styles/tokens.css` 文件头。

## 当前状态（R146）
- 对话链路：工头阿金已能正常回话（G2 新会话 + `compat.allowEmptySignature`，只想不说 0%）；同轮插话已冻结正文。
- 待触发观测 **R141**：G2 会话到 ~100 轮或 captain 上下文 >200k 时，复量"只想不说"比例（团队状态在仓库根 `.agent-teams/agent-world-g2/`）。
- 后续项：场景标签"两人靠近时工单行只藏不排"的歧义（R124 记录）。
```

## ⚠️ 恢复前建议先更新这两段

上面「当前状态（R146）」在停用时已经过时了，恢复时请按当时的真实情况改写。停用时（2026-10-20）的实际状态是：

- 对话链路已能正常回话（R164 修好了服务改名 `agentLoop`→`agents` 与调用形状；leader 回复正常）；
- **未完成**：把队长显示名改成 `leader`（R165 试过并回退，R166 定位到"成员名才是权威，要先定成员名"）；
- **未完成**：内容库花名册里那位仍叫「工头阿金」，导致回复正文自称该名；
- **待触发观测** R141 仍条件未到。
