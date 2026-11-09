## 1. 安装：命令行或直接对 DSH 说

```bash
# 命令行安装（DSH Web）
# 前提：已安装 DSH 和 Python，终端能运行 dsh、python3。
# 只有选装下面的通用 feishu skill 时，才额外需要 Node.js/npm/npx。
# 先获得本版插件目录；替换下面的实际绝对路径和目标 profile。
# 同名 npm 旧包不等于当前本地分发版插件。

# 1) 安装飞书 CLI
python3 -m pip install --extra-index-url https://artifactory.momenta.works/artifactory/api/pypi/pypi-momenta/simple feishu-sync

# 2) 安装 DSH 飞书插件
# 路径须指向本版 dsh-feishu 包，web 可替换为你的目标 profile。
dsh plugin --profile web add "file:/绝对路径/dsh-plugins/packages/dsh-feishu"

# 可选扩展：feishu skill 不属于本插件的运行依赖，默认不用安装。
# 需要额外的通用飞书内容操作能力时，再在目标工作区运行并按提示选择安装位置。
# npx skills install https://mcp-hub.momenta.works/wk/Momenta/public/zhixiong-public-skills/dev --skill feishu

# 可选面板：需要右侧栏「飞书」面板时，再安装 better-sidebar。
# 后台同步和对话工具不要求它；当前侧边面板需要它，已有则无需重复安装。
# dsh plugin --profile web add dsh-better-sidebar

# 3) 重载插件或重启对应 DSH；若选装了 skill，再确认其可被发现。
# 使用面板：飞书 → 配置 → 授权 → 开始授权；完成后点「立即同步」。
# 不使用面板：先用下列命令完成个人授权，再在 DSH 对话里请求同步。
# python3 -m feishu_sync.retoken init_token --enable_autofill
# CLI 未被找到时在插件设置中指定 cliPath；Python 需能导入 feishu_sync。
# 桌面版 profile 由应用管理，优先用下面的 Prompt 安装。
# 不要把密码、Token 或授权码发到对话里。
```

```text
Prompt 安装：替换插件路径后，将以下整段发送到 DSH 对话里。

请在当前 DSH profile 安装并启用飞书插件：
/绝对路径/dsh-plugins/packages/dsh-feishu

同时检查 feishu-sync CLI，缺少时协助安装：
python3 -m pip install --extra-index-url https://artifactory.momenta.works/artifactory/api/pypi/pypi-momenta/simple feishu-sync

feishu skill 不是本插件的运行依赖，默认不要安装。
只有我需要额外的通用飞书内容操作能力时，再使用：
npx skills install https://mcp-hub.momenta.works/wk/Momenta/public/zhixiong-public-skills/dev --skill feishu

核对插件实际加载结果；如果选装 skill，再检查 DSH 能否发现它。
better-sidebar 是面板集成的可选项，不是后台同步或对话工具的硬依赖：
需要右侧栏「飞书」面板且当前没有该组件时再协助安装，否则跳过。

先不要开启自动开工、评论协作或自动进度回写。
飞书个人授权由我在授权页面完成；不要索取密码、Token 或授权码。
安装与授权完成后，再协助同步并检查任务清单。
```

