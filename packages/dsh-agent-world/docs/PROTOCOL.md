# dsh-agent-world —— 模块协议规范

> **一句话：模块之间只通过协议通信，不通过 import 具体实现通信。**
>
> 而且这条**是被机器检查的**，不是文档里的愿望——规则写成数据（`src/protocol/boundaries.ts`），
> 由 `test/boundaries.test.js` 读源码、解析 import、逐条判定，违规就红。

---

## 1. 三条协议，三个层次

| 层 | 位置 | 治什么 | 谁强制 |
|---|---|---|---|
| **进程内端口（port）** | `src/protocol/ports/` | 同进程模块之间的调用面：接口 + 语义 + 入参出参类型 | tsc 的类型检查 + 边界测试 |
| **跨进程线协议（wire）** | `src/protocol/wire/` | host ↔ 浏览器：消息定义、版本、编解码 | `WireDecodeError` + `test/protocol.test.js` |
| **边界规则（boundaries）** | `src/protocol/boundaries.ts` | 谁能 import 谁、谁不许碰什么依赖 | `test/boundaries.test.js`（读源码判定） |

**为什么这三层是分开的**：端口是**调用**的形状，线协议是**字节**的形状，边界规则是**依赖方向**。
把它们混在一起（比如"模块间也序列化成消息"）会让进程内调用白付编解码开销，
还会**丢掉 tsc 的类型检查**——而类型检查才是进程内解耦真正依赖的东西。

---

## 2. 模块边界表

规则全貌在 `src/protocol/boundaries.ts`（每条都带 `rationale`）。这是摘要：

| 模块 | 允许**值** import | 允许**仅类型** import | 禁止的外部依赖 |
|---|---|---|---|
| `protocol/` | — | `domain` | `node:` · `three` · `@deepseek-ai/` |
| `domain/` | `protocol` | `protocol` | `node:` · `three` · `@deepseek-ai/` |
| `content/` | `protocol` `domain` | 同上 | `node:` * · `three` · `@deepseek-ai/` |
| `world/` | `protocol` `domain` `content` | 同上 | `node:` · `three` · `@deepseek-ai/` |
| `sim/` | `protocol` `domain` | 同上 | `node:` · `three` · `@deepseek-ai/` |
| `store/` | `protocol` `domain` | 同上 | `three` · `@deepseek-ai/` |
| `runtime/` | 上面全部 + `sim` `store` `bridge` | 同上 | `three` · `@deepseek-ai/` |
| `bridge/` | `protocol` `domain` `runtime` | 同上 | `three` |
| `tools/` | **`protocol`** | **`protocol`** | `three` |
| `routes/` | `protocol` `runtime` | 同上 | `three` |
| `panel/` | `protocol` | `protocol` | `three` · `@deepseek-ai/` |
| `web/` | **`protocol`** | **`protocol`** | `node:` |
| `app/`（根文件） | 全部 | 全部 | `three` |

\* `content/load-files.ts` 是唯一豁免（它本质是 IO 适配器），理由写在豁免表里。

### 三条最关键的禁令

1. **`sim/` 不许 import `content/`** —— 模拟内核只认**已经装配好的 `World`**。
   一旦它开始 import 内容库，"换一套内容就得动模拟逻辑"，前面拆出来的内容层就白拆了。
2. **`tools/` 只许 import `protocol/`** —— 工具通过**端口**与世界交互。
   改这条规则之前，`tools/world.ts` 里写着 `import type { PluginState } from '../state.js'`，
   那就是耦合：给工具写单测要伪造整个插件状态，换状态管理方式要改工具。
3. **`web/` 只许 import `protocol/`** —— 浏览器侧不许伸手进宿主内部。
   `protocol/` 会把渲染需要的类型转出去，所以这不是限制能力，而是**把宿主的缝收在一处**。

### 为什么要把"类型导入"单列一栏

`import type` 会被编译期**完全擦除**，不产生任何运行时依赖。
`protocol/wire/messages.ts` 必须 import `World` 这个**类型**——世界的形状本来就是契约的一部分。
一刀切地禁止 `protocol → domain`，结果会连"世界长什么样"都写不进协议。
（这是写完第一版规则后自己踩到的坑；所以检查器区分 `import` 与 `import type`。）

---

## 3. 进程内端口（port）

每个模块对外只暴露**接口**，不暴露实现类型。

| 端口 | 位置 | 谁实现 | 谁消费 | 现状 |
|---|---|---|---|---|
| `WorldServicePort` | `ports/world-service.ts` | `state.ts` | `tools/` | ✅ 已用 |
| `ContentPort` | `ports/content.ts` | `content/port.ts` | `tools/` · 面板 | ✅ 已用 |
| `EventSinkPort` / `EventSourcePort` | `ports/events.ts` | `runtime`（M3） | `sim/emit.ts`（M2） | 接口已定，M2 接入 |

### 端口设计的两条规矩

1. **端口里不许出现实现类型**。`ContentPort` 里不会有 `ContentRegistry`，
   `WorldServicePort` 里不会有 `PluginState`——否则消费方又被迫认识具体实现，
   端口就退化成了一个多余的间接层。
2. **端口要能被轻易伪造**。给 `tools/` 写单测时塞一个手写的假 `WorldServicePort` 就行，
   不用起文件系统、不用建真实世界。**如果一个端口做不到这件事，说明它切错了位置。**

---

## 4. 跨进程线协议（wire）

### 4.1 消息

每条消息都带 `v`（协议版本）。六种：

| type | 方向 | 说明 |
|---|---|---|
| `hello` | S→C | 握手：服务端标识 + tick 间隔 |
| `snapshot` | S→C | 全量快照（建连、或发现 seq 断裂时） |
| `events` | S→C | 增量事件批 |
| `command` | C→S | 客户端命令 |
| `ack` | S→C | 命令受理结果 |
| `error` | 双向 | 错误（带稳定错误码） |

定义在 `src/protocol/wire/messages.ts`，命令在 `wire/commands.ts`。

### 4.2 版本策略

* **版本是单个整数**，不做"同 major 就兼容"。这个协议只有我们自己两端，
  宽松匹配的兼容层成本远大于收益；严格相等能保证不匹配**在连接建立时**暴露，
  而不是等某个字段读出 `undefined` 才在画面上表现成怪现象。
* **允许**：新增可选字段、新增消息类型、新增枚举取值（消费方必须对未知取值有默认行为）。
* **必须 bump**：删除字段、改字段语义、改必填性、收窄枚举取值集合。
* 不匹配时的行为：`WireDecodeError('protocol-mismatch')`，**在形状检查之前**就拒绝——
  否则用户会以为是数据坏了，其实是版本没对齐，排查方向被带偏。

### 4.3 `seq` 与 gap 自愈

`snapshot` 与 `events` 都带单调 `seq`。客户端发现 `seq` 不连续（丢包、断线重连、重复投递）
必须**丢掉本地状态重新拉快照**，而不是继续增量应用——后者会造成**静默的状态漂移**：
画面看起来正常，只是某些数据永远差一截。

判据在 `hasSeqGap(previousSeq, nextSeq)`：**倒退与同号都算断裂**（同号 = 重复投递，重放会叠加）。

### 4.4 载荷形状（**R6 记下的欠账，R8 补上**）

之前只写了"事件带 seq"，没说载荷长什么样——面板只能靠读源码猜。现在定死：

**快照** `GET /agent-world/api/world`：

| 字段 | 说明 |
|---|---|
| `v` / `type: 'snapshot'` / `seq` | 协议版本、类型、这个快照对应的世界序号 |
| `world` | **去掉 `events` 的世界**（`WorldSnapshot`）。面板要轮询它，带上最近 500 条事件会让一个快照到几百 KB，而面板不需要历史 |
| `palette` | **调色板 token → 色值**（服务端从 `skins` 库合并好） |
| `runtime` | `{ running, pending, tickMs, diagnostics }` —— 回答"它到底在跑吗"的唯一出口 |
| `content` | `{ packs, libraries }` —— 装了哪些包、各库多少条 |

> **调色板为什么必须随快照发**：面板只许 import 协议层（决策 D16/D19），读不到内容库。
> 地块的 `ground` 字段是 token（形如 `skin.ground.engineering`），面板剥掉 `skin.` 前缀
> 再去 `palette` 里查——这个约定两边都要守，改了要同时改。

**事件载荷**（`world.events` 里每条的 `payload`）：

| type | payload |
|---|---|
| `world.tick` | `{ agents: [id, x, z, facing][] }` —— **元组数组**，过 JSON 会变成普通数组，按位置解包 |
| `agent.state` | `{ id, state, ... }`，可能带 `station` / `task` / `from` / `reason` |
| `task.changed` | `{ id, ... }`，可能带 `status` / `owner` / `station` / `progress` / `milestone` / `reason` / `attemptId` |
| `message.sent` | `{ id, from, to }` |
| `world.paused` | `{ paused }` |

`world.tick` 的元组数组是个**隐式契约**（位置上没有名字），所以写在这里；
要给它加字段就得同时改这里与 `web/app.js` 的解包代码。

### 4.5 HTTP 端点

整个插件只占**一个路由座位**（一个前缀，默认 `/agent-world`），所以与别的插件不可能撞。

| 端点 | 方法 | 说明 |
|---|---|---|
| `/agent-world/` | GET | 面板页面（静态文件，MIME 白名单，未命中一律 404） |
| `/agent-world/api/world` | GET | 快照（见上）。响应带 `Cache-Control: no-store` |
| `/agent-world/api/command` | POST | 体形如 `{"command":{"kind":"pause"}}` |

**命令是入队、不是立刻执行**：它要经下一步 `step()` 的 ingest 段才生效。
否则世界的行为会取决于 HTTP 请求到达的瞬间，直接破坏确定性。

**前缀按整段匹配**：`/agent-world-x` 不属于本插件——只做字符串 `startsWith` 会吞掉
相邻插件的路径，而那种问题极难查。

### 4.6 编解码接缝

业务代码**从不直接碰 JSON**——只调 `jsonCodec.encode/decode`，只认 `WireMessage`。
要换 protobuf，改的是 `wire/codec.ts` 一个文件加一份 `.proto`；**调用点一处不动**。

---

## 5. 为什么现在不做 protobuf（决策 D17）

用户提的是"定好自己的协议**或者** protobuf"。这里给出的判断是：**协议要，protobuf 现在不要**，
但把接缝留好。理由：

1. **进程内的模块之间不该序列化**。`domain`/`content`/`world`/`sim` 之间是同进程函数调用，
   套一层 protobuf 只白付编解码开销，还会**丢掉 tsc 类型检查**——而类型检查才是进程内解耦
   真正依赖的东西。"禁止耦合"靠的是边界规则，不是序列化。
2. **跨进程现在没有带宽压力**。10Hz tick、≤24 个角色，消息量小到测不出来；
   而 JSON 能在浏览器 devtools 里直接看，开发期收益远大于二进制省下的字节。
3. **protobuf 的成本是真实的**：多一套 `.proto` + codegen 流水线 + 构建产物入库。
   本仓库对"新增文件进 profile"本来就有坑（`docs/DEVELOPMENT.md` §7）。

**什么情况下该换**（判据，不是拍脑袋）：单条消息常态 > 64KB、事件频率 > 100Hz、
或者出现**非 JS 的客户端**（那时 codegen 的收益就压过成本了）。

---

## 6. 怎么加东西

### 加一个新模块

1. 在 `src/protocol/boundaries.ts` 的 `ModuleName` 与 `BOUNDARY_RULES` 里加一行，
   **必须写 `rationale`**（测试会检查它够不够长）。
2. 在 `test/boundaries.test.js` 的 `planned` 集合里移除它（如果之前登记过）。
3. 在 `src/protocol/ports/` 下加它的对外端口。
4. 消费方只 import 端口，不 import 它的实现。

漏了第 1 步：新目录不在规则表里，检查器会直接跳过它（`moduleOfPath` 返回 null），
**违规不会被发现**。所以"加模块"这件事没法只靠写代码完成。

### 加一条线协议消息

1. 在 `wire/messages.ts` 里加接口，并加进 `WireMessage` 联合与 `WIRE_MESSAGE_TYPES`。
2. 在 `wire/codec.ts` 的 `assertShape` 里加一个 `case`（**必须**，否则它会被判 `unknown-type`）。
3. 在 `test/protocol.test.js` 里加往返用例与"缺字段要报 bad-shape"的用例。
4. **只是新增消息类型的话不用 bump 版本**（旧对端会判 `unknown-type` 而不是崩）。

### 加一个端口方法

端口方法必须能被"手写假实现"满足。如果新方法要求调用方先构造一堆内部状态，
那说明这个方法不该在端口上，而应该在实现内部。

---

## 7. 常见错误

| 症状 | 原因 | 怎么办 |
|---|---|---|
| 测试报 `模块 "tools" （值）不许 import "domain"` | 工具直接 import 了业务模块 | 把它要的东西加到端口上，工具只认端口 |
| 测试报 `模块 "sim" 不许 import "content"` | 模拟内核开始依赖内容库 | 模拟内核只认装配好的 `World`；需要什么就在装配阶段放进 `World` |
| 测试报 `禁止依赖 "node:"` | 纯逻辑模块里用了 fs/path | 把 IO 挪到 `load-files.ts` 这类适配器里，或在豁免表登记并写理由 |
| 解码报 `unknown-type` | 加了新消息类型但没在 `assertShape` 里加 case | 见 §6 |
| 解码报 `protocol-mismatch` | 两端版本不一致 | 升到同一版本；不要试图兼容——那会把问题推迟成更难查的症状 |
| 画面数据永远差一截 | 收到 gap 还是继续增量应用了 | 用 `hasSeqGap` 判，然后重新拉快照 |
| 加了新目录但没被检查 | 规则表里没有它 | 见 §6，检查器不会检查它不认识的目录 |

---

## 8. 变更记录

| 协议版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-10-14 | 首版：六种消息、六种命令、端口三件套、边界规则与强制检查 |
| v1 | 2026-10-14 | R8 补充：载荷形状（§4.4）与 HTTP 端点（§4.5）。**没有 bump 版本**——只加字段、不改语义 |
