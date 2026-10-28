# Agent World Lab

不打开浏览器，直接快进模拟并审计场景。

## headless

```bash
node tools/aw-lab.mjs sim --ticks 1200 --agents 4
node tools/aw-lab.mjs sim --ticks 1200 --agents 6 --game-mode --json
```

输出：任务完成数、各状态人数、站点占用、移动 tick、audit issues。
有 issue 时退出码为 1，可直接接 CI。

## live

```bash
node tools/aw-lab.mjs live snapshot --url http://127.0.0.1:3082 --token <token>
node tools/aw-lab.mjs live command --url http://127.0.0.1:3082 --token <token> \
  --command '{"kind":"dispatch","taskSet":"task.quick-fix"}'
```

## 规则

- 只读 lib/ 的纯模拟，不启动 webServer、不写盘。
- 同一参数两次输出必须一致；不确定的行为先写进 `docs/agent-world-blockers.md`。

## layout

```bash
node tools/aw-lab.mjs layout
node tools/aw-lab.mjs layout --json
```

检查每个站点的 slot 是否可走、是否从出生点可达、slot 是否重复、容量是否小于 slot 数。

## shot（视觉基线）

```bash
node tools/aw-shot.mjs --url 'http://127.0.0.1:3082/agent-world/?session=...&token=...' \
  --out artifacts/scene.png --width 1440 --height 900 --wait 6000
```

用 Chrome CDP 导航后等待再截图；`--headless=old` 是本机唯一稳定的模式。
输出目录 `artifacts/` 已加入 .gitignore。

## probe（y 排序/运动/动作）

```bash
node tools/aw-probe.mjs --url 'http://127.0.0.1:3082/agent-world/?debug=1&token=...' --wait 5000
node tools/aw-probe.mjs --url ... --expr 'JSON.stringify(globalThis.__agentWorldPhaser.occlusionAudit())'
```

默认输出 `occlusion`、`chairs`、`trace`、`manual`、`stats`。用于断言：
`occlusion.ok === true`、每个 actor 有 `texture/anim`、walking 时不是 idle 动画、工作到站后 `seat` 非空。

## check（门禁）

```bash
node tools/aw-probe.mjs --url '<agent-world?debug=1&token=...>' --wait 5000 --check
# scene check OK
# 失败时打印 issues，退出码 1
```

断言：occlusion 0 异常、0 fallback、每个 actor 有贴图/动画、有目标时播 walk、到目标不播 walk、
desk/meeting 工作时有绑定椅子。

## 连续采样

```bash
node tools/aw-probe.mjs --url ... --wait 2000 --samples 6 --interval 800 --check
```

`--samples` 会连续采样，能抓到“到点仍播 walk”“走路中遮挡异常”这类只在过程中出现的状态。

## 断言场景

```bash
node tools/aw-lab.mjs sim --scenario tools/scenarios/full-flow.json
# scenario OK
```

scenario JSON 支持 `expect: { "minDone": 2, "maxFailed": 0, "noIssues": true }`；
不达标退出码 1，可直接接定时任务/CI。

## dev（测试 profile 热重载替代）

```bash
./tools/aw-dev.sh 3082 awteam
# 自动 build → 重启 3082 → 打印新 token
```

这不是 host 热插拔：DSH 的 Cordis 插件在启动时 import，ESM 缓存不会热替换。
纯 web/ui 改动刷新页面即可；host 路由/模拟改动必须重启进程，这个脚本把重启收敛成一条命令。

## debug 日志

正式面板不放诊断信息。需要排查时看：

```bash
tail -f .agent-world/debug.jsonl
```

JSONL，每行带 `ts` 和 `scope`：
- `agent.report`：subagent 通过 `agent_world_report` 汇报
- `roster.sync`：官方 subagent 花名册同步
- `team.spawn`：请求主会话创建 subagent

路径由 `stateDir` 决定，默认 `<session workspace>/.agent-world/`。

## 场景门禁

```bash
node tools/aw-probe.mjs --url '<测试页>' --samples 5 --check
```

`--check` 现在包含：
- occlusion：深度是否能由底边解释、成对前后关系
- physics：角色脚部 body 是否插进**墙面美术**
- 动画/贴图/座椅：walk/idle 与目标距离、椅子重复、贴图缺失

headless 侧：
- `sim` 审计 path 是否穿过 blocked 格、当前位置是否在墙内
