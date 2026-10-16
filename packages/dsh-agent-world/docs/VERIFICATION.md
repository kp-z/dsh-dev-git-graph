# 每轮验证惯例（VERIFICATION）

> **这份文档是"怎么验"的手册，不是某一次的记录。** 每轮开始照它跑一遍，结束时只更新数字。
> 写于 R24（独立验证者 / `verifier`）。最近的实测数字在文末「本轮记录」。

## 〇、两条纪律（比命令更重要，先读这个）

### 纪律 1：为"还没实现的功能"先写的验收测试，必须标 `todo`，基线永远 `fail 0`

先写验收测试（从契约出发、看实现之前就写）是对的做法，但**"整棵测试树红着"是错的**：
红一旦成为每轮的常态，真正的失败就会被忽略掉。node 的 `todo` 语义正好解决这件事
（R24 由 lead 实测，不是猜的）：

```js
test('todo 且失败', { todo: '功能未实现' }, () => { assert.equal(1, 2) })
test('todo 但通过', { todo: '功能未实现' }, () => { assert.equal(1, 1) })
// → ℹ tests 3 / pass 1 / fail 0 / todo 2
```

所以规矩是：

1. 为未实现功能先写的验收测试，一律 `test(名, { todo: '欠的是哪一条' }, fn)`，
   **`todo` 文案要写明欠哪个里程碑/哪个端点**，不要写"未实现"三个字了事；
2. **基线永远是 `fail 0`**。`fail` 非 0 就是有东西真的坏了，必须当场查，不许归因给"已知红"；
3. **完工的判定 = 去掉 `todo` 后那几条真的转绿**。顺序是
   「先改测试对齐当前契约 → 跑 → 确认从头跑到尾全绿 → 才摘 `todo`」；
4. **禁止改断言迁就实现**——放宽断言是取消验收，不是完成验收；
5. 某条断言在测试环境里**够不到**（例如 `replied` 需要真模型）时，**单独留 `todo` 并写明
   由谁覆盖**，不许为了摘 `todo` 把它删掉或放宽。

### 纪律 2：推演不等于跑过

测试**抛异常中断**时，只能说"**第 N 行之前的断言执行并通过**"，
**不许**说"其余断言通过"——后面的代码根本没跑到（R24 就发生过一次：SSE 用例在第 432 行
抛异常，而有人据此说"其余断言全过"，后来被更正）。

报"验过了"必须附带其中一种证据：

| 证据 | 长什么样 |
|---|---|
| **原始输出** | 该文件的 `✔/✖` 列表 + `ℹ tests/pass/fail` 计数，不是结论句 |
| **变异检查**（推荐） | 把**最后一行**断言故意改错，它必须红在那一行 → 证明整条用例从头跑到尾（命令见 §3.3） |
| **探针输出** | 独立脚本打印真实帧/响应原文（不经过被测断言层） |

另外区分三种说法，不许混：
**「跑过了」**（有输出）／**「推演应该能过」**（只是推理）／**「没验过」**（诚实地说没有）。

---

## 一、固定命令与当前数字

```bash
cd packages/dsh-agent-world

# 所有 pnpm run 都必须带这个环境变量：否则 pnpm 的 run 前依赖校验会去跑根 install 并失败
# （根 install 被 packages/dsh-daily 的过期 RC 钉死，与本包无关）。
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test
```

- `pnpm test` = `tsc` 编译到 `lib/` + `scripts/copy-web.mjs` 同步静态面板 + `node --test test/`。
  **测试跑的是 `lib/` 的编译产物，不是 `src/`**——改了 `src` 不编译就测不到。
- 只跑一个文件（`lib/` 要先有产物，`pnpm test` 会做）：

```bash
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run build
node --test --test-reporter=spec test/acceptance-m6.test.js
```

**判据**：`typecheck` 无输出（= 绿）且 `ℹ fail 0`。数字见文末「本轮记录」。

---

## 二、浏览器实测（面板改动**必须真的看一眼**）

单测绿 ≠ 页面对。任何动到 `web/**` 或它的数据源的改动，都要在真浏览器里打开一次。

### 2.1 起临时服务器

`/tmp/aw-serve.mjs` 是历轮用的临时脚本（**可能存在，也可能被清掉**）。它做的事：

```js
// 摘要：把插件的**真实** handler 挂到 18437，世界 autoStart=false，先 advance(120) 让画面有东西看
const handler = createHandler('/agent-world', { service, runtime, source: hub, tickMs: 100 }, onError)
createServer(handler).listen(18437, '127.0.0.1', ...)
```

在就用：

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run build   # ★ 必须先编译：handler 是启动时 import 进去的
lsof -nP -iTCP:18437 -sTCP:LISTEN                          # 端口被占？看是不是旧进程
pkill -f aw-serve.mjs ; node /tmp/aw-serve.mjs &           # 重启（改了 src 必须重启，它不会热加载）
open 'http://127.0.0.1:18437/agent-world/?debug=1'
```

不在就自己写一个：把上面摘要那段照抄成 `/tmp/aw-serve.mjs`（import 用**绝对路径**
`<包根>/lib/...`，脚本放在 `/tmp` 时相对路径会解析错），换个没被占的端口再起。

两条容易踩的：

- **静态文件是按请求读盘的**（改了 `web/` 编译后刷新即可），
  **但 API/handler 是启动时 import 的**——改 `src/**` 后必须重启临时服务器；
- 临时服务器**没有接 `dialogue` port**（`HttpDeps.dialogue`），
  所以它上面的 `/api/say` 只会走 `thinking → failed`。
  **真实模型回复必须在挂了会话服务的 DSH profile 里看**——
  不许把临时服务器上的结果说成"模型回复验过了"。

### 2.2 看什么

| 看什么 | 怎么看 |
|---|---|
| 页面起来了 | 标题 `Agent World · 俯视图`；`#view-3d` 切 3D 视图 |
| 对话 DOM 在不在 | 页面上应当有 `#dialogue`、`#dialogue-who`、`#dialogue-log`、`#dialogue-input`、`#dialogue-send` |
| 对话真的能走通 | 3D 里点一个小人物 → 面板打开 → 打字发送 → 气泡/日志出现回复；**没有会话服务时要看到"说不出话"的失败提示**（红线 6：失败要退化，不要卡住），不是装作没事 |
| 性能没退化 | §4 |

---

## 三、验收测试：`test/acceptance-m6.test.js`

### 3.1 它和实现者单测的分工

实现者的 `test/dialogue-state.test.js`、`test/bridge*.test.js` 盯内部函数。
**验收测试只认 `src/protocol/dialogue.ts` 里冻结的传输契约**（写它时没读 `src/routes`、`src/bridge`），
用一个"假想面板"的办法驱动：只 `POST /api/say` + 读 `GET /api/events`（真 HTTP 服务器、真 SSE 连接）。

两条刻意的设计（别当疏漏）：

- **信封无关**：契约冻结了 `DialogueEvent` 的**字段**，没冻结它套在哪层帧里
  （`{type:'dialogue',event:{…}}` 还是夹在 `type:'events'` 的事件批里）。所以测试**递归扫描**
  每一帧找"长得像 DialogueEvent 的对象"，而不是断言某种信封——断言信封是在测猜的实现；
- **不钉 `from`/`to` 方向**（`thinking` 是 god→agent、`replied` 是 agent→god 这种推演不进断言），
  只要求"这场对话确实与这个角色有关"。方向由 §3.2 的桩 port 用例验，那里契约是明确的。

### 3.2 覆盖的七条（R24 全绿）

| # | 用例 | 断言要点 |
|---|---|---|
| 1 | 合法请求 | `accepted:true` + 非空 `turnId` + **同步返回**（`< 2s`；在 HTTP 里等模型会把面板拖住，契约第 17–28 行） |
| 2 | 两次搭话 | 两次 `turnId` **不同**（`turnId` 是"这一次搭话"的 id） |
| 3 | 角色不存在 | `accepted:false` + reason 含"不存在"**且**带上被拒 id 或列出可用 id |
| 4 | 文本空/全空白 | `accepted:false` + reason 说清"空"，且不是 5xx |
| 5 | 超过并发唤醒上限 | 用 `maxLiveSessions`（`resolveConfig` 里探测到的配置旋钮）设成 1 → 第二个角色 `accepted:false` + reason **含数字阈值** |
| 6 | SSE 真实退化路径（**不接 port**） | `thinking.text` **= 提问者原话**（契约 R24）、`tick` 是世界 tick 不是墙上时间、`tick ≤ world.tick+1`、`failed.text === ''`、`failed.reason` 可下手（≥8 字）、终态必须出现且 `thinking` 在前 |
| 7 | SSE 回复路径（**接桩 port**） | 桩 `DialoguePort` 回一句话 → 序列恰为 `[thinking, replied]`，`replied.text` = 桩文本，方向 `god→agent` / `agent→god`，同 tick |

第 7 条用桩只替代"模型怎么回"，**不替代传输**：POST 与 SSE 都是真 handler、真 TCP 连接。
这样 `replied` 分支是**真跑过**的，而不是"应该能过"。

### 3.3 变异检查（证明"从头跑到尾"）

```bash
cd packages/dsh-agent-world
P=$PWD/lib
cp test/acceptance-m6.test.js /tmp/aw-mutation.test.js
sed -i '' "s|from '../lib/|from '$P/|g" /tmp/aw-mutation.test.js          # macOS/BSD sed；GNU sed 去掉 -i ''
sed -i '' "s|assert.equal(replied.tick, thinking.tick, |assert.equal(replied.tick, thinking.tick + 12345, |" /tmp/aw-mutation.test.js
node --test /tmp/aw-mutation.test.js      # 期望：fail 1，且报在被改错的那一行
```

R24 实测：`tests 7 / pass 6 / fail 1`，失败点 `at /tmp/aw-mutation.test.js:528`
（用例最后一行）→ **说明前面每一行断言都真的执行过**。

---

## 四、性能项（R21 结论沿用，加对话 UI 后要重新量一次）

3D 视图、`?debug=1` 打开时（**只有带 `?debug=1` 才挂全局句柄**，见 `web/scene3d.js`）：

```js
// 在页面控制台 / browser_execute 里跑（返回 true 的表达式形式，别写 const 语句）
__agentWorldScene3d.benchmark(120)   // → {renders, totalMs, perRenderMs}
__agentWorldScene3d.stats()          // → {planRebuilds, textures, geometries, drawCalls, ...}
```

| 项 | 判据 | 说明 |
|---|---|---|
| `benchmark(120).perRenderMs` | **远小于 16.7ms** | 这是**真实提交成本**。R21 是 0.35ms，R24 是 0.239ms |
| `stats().planRebuilds`（状态栏 `重建 N`） | **必须停在 1** | `>1` = 面板在反复重拉快照重建场景，**这是纹理泄漏的可疑来源** |
| `stats().textures`（状态栏 `纹理 N`） | **不应持续增长** | 看 10 秒前后两个数（R24：18 → 18） |
| `stats().frameMs` / `drawMs` | **不是 CPU 成本** | 它含 vsync 等待（实测恒 ~16.7ms 且与复杂度无关，R21 在这里差点误判）。CPU 看 `benchmark()` 与 `applyMs` |

状态栏性能行就是一行的现成来源：`tick … fps … 帧 …ms（簿记 … / 绘制 …）· 绘制 … · 三角形 … · 纹理 … · 几何 … · 重建 …`。

---

## 五、红线扫描（具体命令，把输出贴进本轮记录）

```bash
cd packages/dsh-agent-world

# [A] 模拟内核不许有墙上时间/随机性（红线 4）：src/sim|domain|content
#     命中要**排除注释**：R24 的两条命中都在注释里（geometry.ts / rng.ts 解释"为什么禁止"）
grep -rnE "Date\.now\(\)|Math\.random\(\)|new Date\(" src/sim src/domain src/content --include=*.ts \
  | grep -vE "^\S+:[0-9]+:\s*(\*|//)" || echo "0 命中"

# [B] 人设是内容（红线 2）：角色名/台词不许出现在代码里
#     角色名清单来自内容库 rosters（src/content/packs/default.ts）——内容改名时同步改这一行
grep -rn "工头阿金\|小蓝\|小铁\|小绿\|小紫\|小青\|小绯\|小雯" src web --include=*.ts --include=*.js \
  | grep -v "^src/content/" || echo "0 命中"
# 人设字段也应当只在内容侧定义：
grep -rn "persona\|speechStyle\|speech_style" src web --include=*.ts --include=*.js | grep -v "^src/content/" || echo "0 命中"

# [C] AI 不能绕过命令改世界（红线 1）：sim/domain 之外直接改世界字段（名单是启发式，命中要人工看）
grep -rnE "\.(agents|tasks|messages|tick|paused|stations|districts|seq|messageSeq)\s*(=[^=]|\.(push|splice|shift|pop|unshift)\()" \
  src --include=*.ts | grep -vE "^src/(sim|domain)/" || echo "0 命中"
# 对话路径专属：bridge/routes 里不许直接写世界
grep -rnE "world\.(agents|tasks|messages)\s*(=[^=]|\.(push|splice|shift|pop|unshift)\()" src/bridge src/routes --include=*.ts || echo "0 命中"

# [D] 对话必须进事件流（红线 3，D38）：不许是面板↔模型的私有旁路
grep -rn "subscribe\|dialogue" src/routes/events.ts | head   # 对话事件要经同一条 SSE 出去
```

**R24 实测**：`[A]` 0 命中（仅 2 条注释）；`[B]` 0 命中；`[C]` 1 处命中
（`src/state.ts:245` `world.tasks.push(...created)`）——已核实是**既有设计**：
派单入口 `dispatch(taskSet)`，且它**必须**跟着写一条 journal 事件（`noteTasksAdded`），
与工具/规则调度走同一条可审计路径，不是旁路。`[C2]` 0 命中。

---

## 六、每轮收尾

1. 更新 `docs/PROGRESS.md` **最上面**那条：做了什么 / 怎么验的（贴数字）/ 下一轮从哪继续 /
   假设 / 卡住的地方；
2. **只 `git add packages/dsh-agent-world`**。**禁止** `git add -A` / `git add .`
   ——工作区里有用户在别的线上的大量未提交改动，那是事故；
3. 提交由 lead 统一做：实现者与验证者都**不提交**，产出留在工作区；
4. 验证者**不改实现**：发现实现与合同不符 → 报 lead，由 owner 修。

---

## 七、本轮记录

### R24（2026-10-15，独立验证者）

**命令与数字（真跑过）**

| 命令 | 结果 |
|---|---|
| `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck` | 绿（无输出） |
| `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test` | `tests 367 / pass 367 / fail 0 / todo 0 / skipped 0`（duration 721ms，367 条全跑） |
| `node --test --test-reporter=spec test/acceptance-m6.test.js` | `tests 7 / pass 7 / fail 0 / todo 0`（229ms） |
| 变异检查（§3.3，故意改错最后一行） | `tests 7 / pass 6 / fail 1`，红在 `/tmp/aw-mutation.test.js:528` |

> **这组数字对应的树**：跑之前 `src/routes/dialogue.ts` 在 15:18:06 被改过，
> `lib/routes/dialogue.js` 由本次运行在 15:18:38 重新编译 → 数字**包含该改动**。
> ⚠️ **但队友仍在并行改 `src/**`**（`bridge/dsh-adapter.ts` 15:10、`routes/dialogue.ts` 15:18…）。
> 所以：**提交前 lead 必须在冻结的树上再跑一次 §一 的两条命令**——
> 任何一次"绿"都只对它编译时的那份源码负责（`pnpm test` 会先 tsc，这点由 `lib/*.js` 的
> mtime 晚于 `src/*.ts` 可核对）。

**本文件这一轮的变化**：7 条验收测试从 `todo`（欠 M6-3）**先真跑绿、才摘掉 `todo`**；
其中第 6 条按 R24 的新契约把 `thinking.text` 从"空串"改成"**提问者的原话**"
（旧断言与 D38 冲突，是**测试**过时，不是实现不合契约）。

**探针证据（独立于被测断言）**：`/tmp/aw-say-probe.mjs` 走真 handler + 真 SSE，实测

```
POST /api/say → 200 {"accepted":true,"turnId":"turn-1"}
帧 1: {"v":1,"type":"dialogue","event":{"turnId":"turn-1","tick":0,"phase":"thinking","from":{"kind":"god"},"to":{"kind":"agent","id":"agent-1"},"text":"你好，你是谁？"}}
帧 2: {"v":1,"type":"dialogue","event":{"turnId":"turn-1","tick":0,"phase":"failed","text":"",
        "reason":"对话通道没启用（DSH 会话服务不可用）：这句话已经登记，但没有会话能回它。确认插件加载的 profile 里挂了会话服务，再试一次。"}}
```

**浏览器实测（真的打开了）**：`http://127.0.0.1:18437/agent-world/?debug=1`
标题 `Agent World · 俯视图`；`#view-3d` 可切；对话 DOM 齐全
（`#dialogue`/`#dialogue-who`/`#dialogue-log`/`#dialogue-input`/`#dialogue-send`）；
`benchmark(120)` = **0.239ms/次**（total 28.7ms）；`重建 1`；`纹理 18`（10 秒后仍 18）；
绘制 42 / 三角形 7,634 / 几何 18 / 簿记 0.08ms。

**没验到的（不许说成验过）**

1. **真实模型回复**：`replied` 只用桩 `DialoguePort` 验了**传输**；真模型的语气/内容要在
   挂了会话服务的 DSH profile 里看（临时服务器没有 port，序列只会 `thinking → failed`）；
2. **M6-2 人设仍是脚手架**：`src/index.ts:217 placeholderPersona` 还在接线上
   （它刻意没有人设字面量，所以**不**违反红线 2，但 G2"用自己的语气回话"尚未成立）；
   内容库还没有 `persona`/`speechStyle`/`goals` 字段（`[B]` 扫描证实）；
3. **M6-4（让角色干活）/ M6-6（对话落库回放）**：本轮未验。

---

## R65 · 键盘控制与"后台标签页"这个测量障碍

### 结论：键盘没能在真机手按验证，但**依据是齐的**

「没验」不等于「不知道」——把能拿到的证据分开列，比含混地说"没验"有用：

| 证据 | 结果 |
|---|---|
| 键盘事件进不进得去 Phaser | ✅ `probeKeydown: 1`；`manager.target` = **`[object Window]`** |
| 四个键注册了吗 | ✅ `keys = [65, 68, 83, 87]`，全部 `enabled: true`（= `addKey('A'/'D'/'W'/'S')` 建的） |
| `D` 推相机了吗 | ✅ 实测 `scrollX -700 → -678`（**+22**） |
| 松键停得住吗 | ✅ `keyup` 后 `scrollX` 不动 |
| **方向是否四个都对** | ❌ 只验到 `D`（往右）。`A`/`W`/`S` 没拿到足够帧 |

`+22` 这个位移量还**反过来印证了速度常量**：`KEY_SPEED = 420 px/s`，一帧 50ms → 21px，
正是 +22。也就是说**帧只推进了一帧**——这引出了下面这条障碍。

### 障碍：`document.hidden` 时 Phaser 的 rAF 循环不推进

实测：标签页 `hidden` 时 **4 秒 0 帧**（给 `camera.update` 装了计数器确认）。
所以"用脚本按住键、等几帧、读结果"这条路在后台标签页上是走不通的——
`D` 能动是因为两次调用之间恰好过了一次帧。

**这已经是第三次栽在同一件事上**（① R57 的 drawCall 读 0；② panel 报的
"`getBoundingClientRect` 返回上一次布局"；③ 这次）。所以记成规矩：

> **任何依赖"引擎在跑"的验证，必须先确认页面在前台。**
> 判据是 `document.hidden === false` **且**一个帧计数器在动——
> 不能只看 `actualFps`（它读的是历史值，`hidden` 时仍显示 60，会骗人）。

### 顺带记两个"我自己的测法错了"

1. **`hasWASD` 判 false**：我写了 `keys.includes('W')`，但 Phaser 的按键表用
   **keyCode 作键名**（`65/68/83/87`）。代码没错，是我的断言写错了。
   → 教训：**断言引擎内部结构时，先打印一次真实形状**，别照直觉写。
2. **替换 `scene.update` 装探针数不到帧**：Phaser 主循环缓存了方法引用，
   替换实例属性没用。改成包 `camera.update` 才数到了（相机每帧必被调）。
   → 教训：**给引擎装探针要选"确实每帧被调用的那个对象"**，否则 0 帧会被误读成"没在跑"。
