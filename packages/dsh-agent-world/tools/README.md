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
