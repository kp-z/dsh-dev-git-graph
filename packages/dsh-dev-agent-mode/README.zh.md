# dsh-dev-agent-mode

将 DeepSeek Harness 左侧对话分类栏切换为 **Agent 模式** 的 DSH 插件（纯前端，MVP 第一步）。

## 这是什么

左侧栏与官方**完全一致**（不替换任何官方组件），额外为每个 workspace 行添加**可点击更换的头像**：

- 每个 workspace 默认一个**确定性头像**（workspaceId → 色相 + 首字母的圆形色块）；
- **点击头像**弹出选择器：8 个预设色块 / 12 个 emoji / 重置默认；
- 选择持久化到 `localStorage`，刷新后保持；
- 官方全部功能（展开/折叠/新建/重命名/删除/拖拽/搜索）**原样保留**；
- 左侧栏头部「分组方式」按钮旁的模式切换按钮（🤖 Agent 模式 ↔ 👁️ 官方模式）。

## 安装

```bash
dsh plugin --profile web add file:/path/to/dsh-plugins/packages/dsh-dev-agent-mode
# 重启 dsh web
```

## 机制（为什么这么实现）

| 项 | 说明 |
|---|---|
| 路线 | **DOM 增强**，不遮蔽孔位、不重写官方组件——官方 WorkspaceBrowser 原样渲染，功能 100% 一致 |
| 注入 | MutationObserver 监听侧栏，识别「含文件夹图标的 treeitem」= workspace 行，在文件夹图标前插入头像元素 |
| 定位 | `ctx.workspaces.list.getSnapshot()` 建 title→workspaceId 索引（行 DOM 无 id 属性） |
| 持久化 | `localStorage['dsh-dev-agent-mode.avatars']` = `{ [workspaceId]: {type:'color',hue} \| {type:'emoji',char} }` |
| 自愈 | React 重渲染替换行 DOM 后，MutationObserver 自动重新注入（清旧+注入） |
| 开关 | DOM 注入到官方头部 `headerActions`（分组方式按钮旁），不占用 footer 孔位 |
| 构建 | 无打包器：`src/client.js` 拷贝为 `lib/client.js`（IIFE，仿 dsh-dev-git-graph） |

详见 [`docs/DESIGN-dsh-dev-agent-mode.md`](../../docs/DESIGN-dsh-dev-agent-mode.md)。

## 开发

```bash
pnpm --filter dsh-dev-agent-mode typecheck   # 类型检查
pnpm --filter dsh-dev-agent-mode test        # 单测（node:test）
pnpm --filter dsh-dev-agent-mode build       # 构建 lib/
```

## 配置

- 模式：`localStorage['dsh-dev-agent-mode.mode']` = `agent`（默认） | `official`
- 头像偏好：`localStorage['dsh-dev-agent-mode.avatars']`（JSON 对象，key=workspaceId）

## 已知边界（MVP 第一步）

- 头像仅支持预设色块/emoji，暂不支持上传自定义图片；
- 头像只显示在左侧栏 workspace 行（会话行、搜索结果未联动）；
- Agent 名称/个性/工具权限不在本插件范围（后续版本）。
