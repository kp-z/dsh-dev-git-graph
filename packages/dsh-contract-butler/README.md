# dsh-contract-butler · 协议管家

给一个项目做**契约纳管**：从代码里反向抽出边界契约（输入输出的形状），盯着它随版本演化，
再拿运行时的真实载荷去对照声明。要解决的是"AI 写实现、人管约定"时最容易失控的那一环——
接口的输入输出如果没有一个可被人审阅的单一出处，AI 各写各的，很快就没法扩展也没法升级。

## 它做的事

| 层 | 表 | 回答的问题 |
| --- | --- | --- |
| 纳管 | `projects` | 哪些项目被盯着，基线是哪一版 |
| 定义 | `contracts` | 这条边界声明了什么形状 |
| 快照 | `snapshots` | 它在某一版上长什么样 |
| 演化 | `changes` | 从基线到现在，哪里变过、是不是破坏性 |
| 运行 | `observations` | 真实调用是否对得上声明 |
| 决策 | `decisions` | 人对上述一切做过的判断 |

人只有两个写入口：**纳管**（决定管什么）和**决策**（决定怎么看待变化）。契约本身是代码的投影，
所以"改契约"这个动作不存在——改了代码，契约自己会跟着变，工具负责告诉你它变了。

## 安装 / 卸载

```bash
pnpm build
pnpm install:web      # 或 dsh plugin --profile web add dsh-contract-butler
pnpm remove:web       # 或 dsh plugin --profile web remove dsh-contract-butler
```

装好后重启 dsh，右侧栏会出现「契约」页签。

## 面板

界面在 `src/panel.html`：自包含的单文件页面，通过宿主路由
`/dsh-contract-butler/panel` 提供，客户端那半边（`src/client.js`）只负责把它嵌进右侧栏页签。
单独调面板不必装到 profile 里：

```bash
node scripts/dev-server.ts 4599     # 内存存储 + 演示项目，重启即清空
# 打开 http://127.0.0.1:4599/dsh-contract-butler/panel
```

### 面板的第三方资源（不走 CDN）

字段表是**真表格**（首列固定 + 列宽可拖 + 表头可排序 + 横向滚动），用的是 Tabulator：

| 资源 | 版本 | 许可 | 来源 |
| --- | --- | --- | --- |
| `src/vendor/tabulator.min.js` + `.min.css` | 6.5.3 | MIT | `unpkg.com/tabulator-tables@6.5.3/dist/…` |

三个文件的 sha256 与来源 URL 记在 `src/vendor/README.md`（升级时四个数一起改）。构建把
`src/vendor/` 同步到 `lib/vendor/`（`npm run build:assets`），运行时由宿主那条**只读白名单路由**
`GET /dsh-contract-butler/vendor/:file` 吐出来：命中给一年 `immutable`（面板引用带 `?v=6.5.3`
当缓存钥匙），未知名字 / `..` / URL 编码穿越一律 404，磁盘缺失才 500 且带可读路径。

- **组件没加载出来也不静默失败**：字段表退回静态渲染（仍是定宽列 + 首列固定 + 横向滚动，
  只是不能拖列宽、不能排序），并在表上方写明「高级表格组件未加载，已退化为静态表」。
- 拖过的列宽存在 `localStorage['dsh-contract-butler.cols']`，输入/输出两张表共用一份，刷新还在。

## AI 理解用的是宿主的模型服务

插件**不自建 AI 通道**：不读配置文件、不直连任何网关、更不碰密钥。它只向宿主要
`ctx.get('llm')`（`@deepseek-ai/dsh-llm`）与 `ctx.get('agentDefaultModel')`，
用 `llm.stream({ provider, model, system, messages, maxTokens, signal })` 发提示词、把
`text-delta` 拼成文本。凭据始终留在宿主进程里。

- **走哪条线由宿主的事实决定**：宿主的默认模型 → 同名模型换个已注册 adapter 的 provider →
  其余已注册 provider 各一条；`llm.listProviders()` 里没有的 provider 不会被发出去
  （真机上踩过：默认模型指着 `mmt-vision`，而它根本没有注册 adapter）。
- **按顺序换线，但只在"发不出去"时**：`no adapter registered` / 401 / 连不上才换下一条候选；
  截断、没文本、校验不过都属于"这批没成"，绝不换线掩盖。换线会写进日志与 `/status` 的说明里。
- **配置**：`understandProvider` 钉死 provider（钉错=503 并列出宿主注册了什么，不偷偷换线）；
  `understandModel` 给 `provider:model` 或裸模型名；都不配就按宿主的默认。
- **没有 AI 就是没有**：宿主没挂 `llm` 时 `/understand` 是 503 + 可读原因，面板照实显示；
  任何时候都不会在本地"猜一个中文"补上。独立跑面板（`scripts/dev-server.ts`）时那条原因也是
  同一句。

## 两条运行期约束

- **记录 schema 必须是 zod。** `domainTable()` 的值 schema 会在领域打开时被
  `valueSchema.parse(raw)` 逐条校验；用 schemastery 不会报类型错，而是打开领域时抛
  `parse is not a function`。另外 zod 默认剥掉未声明的字段，所以每条记录都得把自己的 `id`
  写进 schema，否则落盘再读出来 id 就没了。
- **插件从不改动被纳管的项目。** 抽取是只读的，观测只存形状指纹；`capturePayloads` 默认关闭，
  枚举越界只记数量不记取值。

## 验证

```bash
pnpm test        # 168 项：形状/抽取/一致性/监视/AI 面（挑线·换线·校验·缓存）/整链路装配/客户端注册/面板静态资源
```

装配测试（`test/wiring.test.ts`）用假宿主把插件整体装起来，跑的就是
「纳管 → 重扫发现变化 → 观测到不符 → 决策」这条主链路。
