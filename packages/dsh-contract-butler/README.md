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

## 两条运行期约束

- **记录 schema 必须是 zod。** `domainTable()` 的值 schema 会在领域打开时被
  `valueSchema.parse(raw)` 逐条校验；用 schemastery 不会报类型错，而是打开领域时抛
  `parse is not a function`。另外 zod 默认剥掉未声明的字段，所以每条记录都得把自己的 `id`
  写进 schema，否则落盘再读出来 id 就没了。
- **插件从不改动被纳管的项目。** 抽取是只读的，观测只存形状指纹；`capturePayloads` 默认关闭，
  枚举越界只记数量不记取值。

## 验证

```bash
pnpm test        # 68 项：形状/抽取/一致性/监视/整链路装配/客户端注册
```

装配测试（`test/wiring.test.ts`）用假宿主把插件整体装起来，跑的就是
「纳管 → 重扫发现变化 → 观测到不符 → 决策」这条主链路。
