# dsh-dev-agent-mode

把 DeepSeek Harness 左侧对话分类栏切换为 **Agent 模式** 的 DSH 插件（纯前端，MVP 第一步）。

## 这是什么

左侧栏与官方**完全一致**（不替换任何官方组件），额外为每个 workspace 行添加**可点击更换的头像**：

- 每个 workspace 默认一个**确定性头像**（workspaceId → 色相 + 首字母的圆形色块）；
- **点击头像**弹出配置窗口，五条来源任选：
  - **推荐**：DiceBear 9.x 公共头像库 24 个（4 种风格 × 每 workspace 确定性种子；离线自动降级）；
  - **AI 生成**：输入描述（如「赛博朋克猫」），调你的默认 LLM 文生 SVG（会先净化：剥 script/外部引用/事件属性）；
  - **上传**：本地图片，**超过 150KB 自动压到 128×128 PNG**；
  - **色块**：8 个预设色相；
  - **Emoji**：12 个预设。
- 选择持久化到 `localStorage`（单个头像 ≤200KB dataURL），刷新后保持；
- 官方全部功能（展开/折叠/新建/重命名/删除/拖拽/搜索）**原样保留**；
- 左侧栏头部「分组方式」按钮旁的模式切换按钮：**Agent 模式（机器人图标）↔ 官方模式（文件夹图标）**，纯图标无文字，悬停有提示。

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
| 持久化 | `localStorage['dsh-dev-agent-mode.avatars']` = `{ [workspaceId]: {type:'color',hue} \| {type:'emoji',char} \| {type:'image',dataUrl} }`（image ≤200KB dataURL） |
| 自愈 | React 重渲染替换行 DOM 后，MutationObserver 自动重新注入（清旧+注入） |
| 开关 | DOM 注入到官方头部 `headerActions`（分组方式按钮旁），不占用 footer 孔位；纯图标按钮（Agent=机器人 / 官方=文件夹），无文字 |
| 预选头像 | DiceBear 9.x 客户端直连（`api.dicebear.com/9.x/{style}/svg?seed=…`，CORS 开放、单图 ~1.5KB SVG），seed 混入 workspaceId 让每个 workspace 看到不同推荐；离线或全部失败时该区块显示「推荐不可用（需外网）」 |
| AI 生成 | `POST /dsh-dev-agent-mode/api/avatar-suggest {prompt}` → host 用用户默认模型 `ctx.llm.stream()` 文生 SVG → 白名单净化（剥 script/foreignObject/on*/href/外部 url，注入缺乏的 `xmlns` 和 `viewBox`）→ dataURL 回包。服务降级：无默认模型时 503 no-model，客户端 AI 按钮提示「请先在设置里配置默认模型」。**注意：DSH 官方 DeepSeek 适配器 text-only，支持的是「文生 SVG」而非位图生成。** |
| 大小管控 | 三层防线：host 净化后硬顶 150KB（超出 413）；客户端 `acceptImageDataUrl` 位图 >150KB 时 Canvas 压到 128×128 PNG；store 归一化 `< MAX_IMAGE_DATA_URL(200KB)` 兜底 |
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

## 已知边界

- 预选头像依赖公网（DiceBear CDN），离线自动降级不影响其它功能；
- AI 生成需要用户配置默认模型（`Settings → Models → Default`），输出为 SVG 矢量头像（非位图）；
- 头像只显示在左侧栏 workspace 行（会话行、搜索结果未联动）；
- Agent 名称/个性/工具权限不在本插件范围（后续版本）。
