# dsh-tab-split

DSH 插件：会话**视图分屏**——把任意视图（对话 / Git 树 / 已入驻视图）拆成左右并排窗格。

## 与 @syncended/dsh-split-screen 的区别

| | dsh-tab-split（本插件） | @syncended/dsh-split-screen |
|---|---|---|
| 分屏对象 | **同一会话内的任意视图**（对话 × Git 树等并排） | 多个会话各自的紧凑聊天 |
| 机制 | 新增一个 `conversation.view` tab，纯增量，不替换官方任何东西 | 接管整个 `conversation` 中栏 |
| 官方视图环 | 保留，官方对话/轨迹/Git树 tab 都在 | 被 shadow，只剩自绘聊天 |
| 聊天内容 | 内置自绘紧凑聊天窗格（官方同源 `useSession` 快照，支持流式） | 插件自绘的紧凑消息行 |

## 为什么「对话」是自绘的（不是官方聊天组件）

调研结论：官方聊天/轨迹视图组件是包内私有闭包，且聊天依赖私有的 `conversation.chat.node` 渲染绑定；
slot 声明账本全局唯一、`SlotOutlet` 为 renderer 私有——**任何插件都无法复用官方视图组件**，只能自绘。
本插件的对话窗格消费框架标准 `useSession`（`ConversationSnapshot`，官方聊天同源数据），
支持流式（`partial` 增量）、运行中工具、排队消息、轮次错误。不含富卡片/消息操作条/详情联动——完整交互在官方主视图。

## 行为

- **默认保持官方单视图**，安装后什么都不变。
- **右键任意视图 tab**（对话/轨迹/Git树/…）→ 弹「⧉ 向右拆分到分屏」→ 进入分屏视图并新增对应窗格。
- 也可点会话头「⧉ 分屏」按钮或分屏视图空态的「开始分屏」按钮。
- 每窗格：下拉切换视图、`⧉` 向右拆分、`×` 关闭、拖分隔条调比例；最多 4 窗格。
- 布局按会话持久化在 `localStorage`（`dsh.tab-split.panes.<sessionId>`）。
- **退出分屏**：点击任意官方视图 tab（官方 `setView` 自然切走）。
- 右键拆分映射：对话→`pane-chat`，Git 树→`git-graph-pane`（dsh-git-graph 入驻），其他→空窗格供下拉选择。

## 视图入驻协议（给其他视图插件）

```js
slots.inject("tabsplit.pane", () =>
  slots.register(
    { name: "tabsplit.pane", id: "my-view-pane", order: 20, label: () => "我的视图" },
    (props) => <MyView {...props} />   // props 带标准 session kit（sessionId、useSession…）
  )
);
```

`slots.inject` 在 `tabsplit.pane` 尚未声明时自动排队，不依赖加载顺序。已入驻：`dsh-git-graph`（`git-graph-pane`）。

## 已知限制

- 官方「轨迹」「上下文」「记忆系统」等视图进窗格需各自按协议入驻（一行 `slots.inject`）；本期内置仅对话 + Git 树。
- 右键菜单与「分屏」按钮依赖官方视图 tab 的 `role="tab"` DOM（无标注，变更需跟进）。
- 自绘聊天是紧凑视图：无富卡片注册表、消息操作条、详情联动。

## 开发

```bash
pnpm build          # 产出 lib/src/index.js + lib/client.js
pnpm typecheck
```
