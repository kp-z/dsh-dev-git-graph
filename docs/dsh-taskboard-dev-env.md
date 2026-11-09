# dsh-taskboard 开发环境（2026-09-07 配置）

> 目标：clone 上游 `cloader/dsh-taskboard` 到本机，配置可开发、可提 PR 的环境。
> 仓库位置：`/Users/kp/DEV/dsh-plugins/dsh-taskboard`（独立 .git，与 dsh-plugins 工作区互不干扰）。

## 关键路径与版本

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/cloader/dsh-taskboard.git |
| 本地路径 | `/Users/kp/DEV/dsh-plugins/dsh-taskboard` |
| 当前 HEAD | `e72fa7c`（0.6.4，与 upstream main 一致） |
| Node（上游 CI 固定） | **22.x**（workflow 矩阵 `[22.x]`，engines `>=22`） |
| 本机默认 node | 25.5.0（**与上游不兼容**，见下） |
| 本机 node@22 | `/opt/homebrew/opt/node@22/bin`（brew keg-only，v22.23.2） |
| npm 缓存 | `/Users/kp/.npm-dsh-taskboard`（绕过 `~/.npm` 的 root-owned 文件问题；原在工作区内，2026-09-09 移出——dsh 文件监听器递归 watch 数千个缓存分片目录导致 EMFILE 崩溃。使用时加 `npm --cache /Users/kp/.npm-dsh-taskboard` 或 `export npm_config_cache=/Users/kp/.npm-dsh-taskboard`） |

## 为什么必须用 Node 22（本机踩坑记录）

- 本机默认 node 25.5.0 下 `npm test` 有 **26 项失败**，全部是 `localStorage.clear is not a function`：
  vitest 3.2.7 + jsdom 25 在 Node 25 注入的 localStorage stub 残缺（无 clear 方法），纯环境兼容问题，与代码无关。
- 上游 CI（Node 22.x）全绿；本机 node@22 下 `npm test`（串行）**270/270 全过**。
- 另：brew 升级 simdjson 到 4.6.11 后，node 25.5.0 引用的 `libsimdjson.29.dylib` 消失，
  `/opt/homebrew/bin/node` 直接跑 npm 会 `Abort trap` / `Library not loaded` 崩溃。**不要用默认 node 跑 npm**。

## 日常命令（务必加 node@22 PATH）

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

cd /Users/kp/DEV/dsh-plugins/dsh-taskboard
npm install            # 首次（npm ci 更严格，需 lockfile 一致）
npm run build          # host ESM + client CJS 双构建
npm run typecheck      # tsc --noEmit
npm test               # vitest —— 注意：默认并行下 session-sync 3 项偶发失败（20ms 事件竞态）
npx vitest run --no-file-parallelism   # 推荐：串行 270/270 稳定全绿
```

> 注意：npm 命令请用 `npm`（PATH 已带 node@22）；不要用 `/opt/homebrew/bin/node`（会崩）。
> `--no-file-parallelism` 是稳定性关键：并行模式 267/270，串行 270/270。

## 仓库结构速览（0.6.4）

```
src/
  index.ts              # 插件入口（host 侧挂载）
  host/                 # 宿主侧：routes/工具/存储/执行/隔离/调度/会话同步
  client/               # Web 侧：React 看板/控制器/SSE/侧边栏入口/i18n
  shared/               # 协议与版本
lib/                    # 构建产物（提交进仓库，github: 安装无需构建）
tests/                  # vitest 266+ 项（含真实 git 镜像集成测试）
scripts/                # clean-lib / wrap-client / screenshot
cordis.patch.yml        # dsh 插件 bundle patch
```

## 提 PR 流程（你之后要做的事）

1. 本地建分支：`git checkout -b feat/xxx`
2. 开发 → 构建/类型/测试验证（用上面命令）
3. fork 上游（gh 已登录 kp-z）：`gh repo fork cloader/dsh-taskboard --clone=false`
4. 推分支到 fork，`gh pr create --repo cloader/dsh-taskboard`
5. 注意 `.nvmrc` 已添加（Node 22 固定，与 CI 对齐）——可随 PR 一并提交或单独 PR

## 尚未处理（如需可继续）

- 本机默认 `node` 的 npm 崩溃（simdjson 依赖失效）：需 `brew upgrade node`（需 sudo 写 /opt/homebrew）或重装 node 25。不影响 dsh-taskboard 开发（用 node@22 即可）。
- 串行测试的 3 项竞态失败若想根治，可给上游提「session-sync 测试等待改为轮询 waitFor」的 PR（当前 20ms setTimeout 在并行负载下不稳）。
