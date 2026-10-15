# dsh-agent-world —— 轮次台账（PROGRESS）

> **这是轮次交接文档。** 每轮开始先读这里，结束必须更新这里。
>
> **R18 末定时任务已取消**（用户要求）。轮次编号到此为止，之后由人决定何时继续；
> 但这份台账的规矩不变——下一轮照样先读最上面那条「下一轮从哪继续」。
>
> 更新规则：
> 1. 在最上面加一条本轮记录（倒序，最新的在上）。
> 2. 记录必须包含：**做了什么 / 验证怎么跑的 / 下一轮从哪继续 / 假设 / 卡住的地方**。
> 3. 「下一轮从哪继续」要具体到文件与函数名，不要写"接着做 M1"。
> 4. 不要删历史记录。台账的价值就在于"三个月后还能看懂当时为什么这么做"。

---

## 环境备忘（每轮都会用到，先看这里）

```bash
cd packages/dsh-agent-world

# 首次 / 依赖缺失时：本包**独立安装**，不走根 workspace
#（根 `pnpm install` 目前被 packages/dsh-daily 的过期 RC 钉死，与本包无关，原因见本文件 R1 的「卡住」一节）
pnpm install --ignore-workspace --lockfile=false

# 之后所有 pnpm run 都要带这个环境变量，否则 pnpm 的 run 前依赖校验会去跑根 install 并失败。
# 这是**唯一的**可靠手段：包内的 .npmrc 写 `verify-deps-before-run=false` 不管用
#（pnpm 读的是 workspace 根的 .npmrc），而且 .npmrc 被仓库级 .gitignore 忽略、根本不会进版本库。
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run build
```

当前验证状态（R20 末）：`typecheck` 绿 · `test` 286/286 绿。**外网已恢复。定时任务已取消（用户要求）。**

---

## R20 — 2026-10-15 · 办公室变成真家具：3D 路线定案（M4-7 的延伸）

### 先回答用户的问题：有没有"同类项目的 3D 模型"

**搜了，结论是：同类项目基本都是 2D——包括最出名的那个。**

| 项目 | 渲染 | 证据 |
|---|---|---|
| `a16z-infra/ai-town`（最出名的 AI 小镇，MIT） | **2D** | 依赖是 `pixi.js` / `@pixi/react` / `pixi-viewport`；素材只有 `assets/ui/*.png`、`background.webp` |
| `KsanaDock/Microverse`（用户给的） | **2D 顶视像素** | 视觉确认 + 698 张 `Modern_Office_Singles_32x32_*.png` |
| GitHub 上搜"ai town / multi agent simulation" | 14 + 124 个候选 | 全是小项目、多数无许可、**没有一个是 3D 的** |

原因很实在：这类项目的视觉是"俯视小镇/办公室"，**2D tileset 是成本最低的表达**，
而项目的重心在 LLM 对话上，不在画面。

**但"找不到同类项目的 3D 模型"不等于 3D 路线不可行**——恰恰相反：

1. **我们已经在跑 3D 了**（R15–R19 建起来的三维管线 + GLB 加载），转 2D 是**丢掉刚建立的能力**；
2. **3D 素材有干净且可执行的来源**（CC0），而那两个 2D 项目的素材**许可不明**（不能 vendor）；
3. 2D 像素风要重做美术方向，而 3D 只差"一套家具模型"。

所以按用户给的判据（"找不到 3D 就 2D 也行"），**条件不成立 → 继续 3D**。

### 做了什么

**1. vendor 了 Kenney Furniture Kit 的办公室子集（CC0）**

- 直链 `https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip`
- 整包 5,130,729B，sha256 `e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0`
- 里面有 **140 个 GLB**，实测 **CC0**；**只取 31 个办公室用得上的**（不要卧室/卫浴/厨房 36 个件）
- 31 个 GLB + License，**共 355KB**，**无外部贴图依赖**（都是自包含的）

**2. `pack.kenney-furniture`：用内容覆盖 6 个站点模型**

```
model.station.desk       → kenney-furniture/desk.glb
model.station.meeting    → kenney-furniture/table.glb
model.station.server     → kenney-furniture/bookcaseClosedWide.glb
model.station.mailroom   → kenney-furniture/cardboardBoxOpen.glb
model.station.lab        → kenney-furniture/deskCorner.glb
model.station.breakroom  → kenney-furniture/loungeSofa.glb
```

加上 R19 的 `pack.kenney-mini`（角色），现在**人与陈设都来自外部 GLB**，
而 `src/sim/`、`src/domain/`、`src/scene/`、`src/protocol/`、`src/routes/` **仍然一个字都没改**。

**3. 两处只能由机制解决的事（都不是内容能填的）**

**① 比例**：Kenney 的模型与我们镇上的尺度不一致。实测
`desk` 高 **0.38**、`bookcaseClosedWide` 高 **0.79**、`loungeSofa` 高 **0.46**；
角色 `character-male-a` 自然高 **0.671**（乘 2 后 1.34）。
现实里书桌 0.75m、人 1.7m，比例 **0.44** → 按 1.34 的人算，桌子该 0.59 高 → `0.59/0.38 ≈ 1.55`。
取 **1.5**（桌子 0.57，是人的 43%）——与真实比例几乎一致。

**② 原点在角上**（这个更隐蔽）：实测 `desk` 的包围盒是 `x -0.01..+0.72 / z -0.38..+0.18`
——**Kenney 家具的原点在角/边上，不在中心**。而站点的 `anchor` 是"中心"，直接摆会整体偏出去半间屋子。

修法有两条：在内容里给 31 个模型各写一个偏移量（数据随模型数量膨胀，换模型还要补），
或者**在渲染器里按包围盒自动摆正**。选了后者——那是"怎么把任意外部模型放进来"的通用能力，
所以它属于**机制**。新增 `scene3d.js` 的 `recenterOnGround()`：
x/z 居中、底面贴 y=0。对已经居中的模型（Kenney 的角色）是**无操作**，所以不需要开关。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 286 / pass 286 / fail 0
```

测试数没变（286）——这一轮**没有新增测试**，而是**已有测试自己抓住了三处新情况**：

- `内置内容声明的每个 GLB 地址，都必须在 src/vendor/ 下真的有那个文件`（R19 加的）
  ——新加的 6 条家具映射被它自动覆盖；
- `白名单与 src/vendor/ 的目录内容一一对应`（R18 加的）——31 个新文件必须逐个登记；
- 三处 `packs` 列表断言 + 一处"站点模型仍是程序化的"断言 → 因为默认内容真的变了，
  已按新事实更新（这本身说明那些断言是**有效的**，不是摆设）。

**浏览器实测**：

| 检查 | 结果 |
|---|---|
| GLB 请求数 | **7**（6 种家具 + 1 个角色）——10 个站点共用 6 个模型，**去重生效** |
| 每个 GLB 的 MIME | `model/gltf-binary`，魔数 `glTF` |
| 白名单外的家具（`bathtub.glb`） | **404** |
| 占位残留 | **灰蓝 0 像素、品红 0 像素** |
| 3D 画面 | 颜色数 **1377 → 2102**（同相机同光照，家具的细节更多） |
| 视觉确认 | 书桌区 / 长桌 / 沙发 / 高柜 / 纸箱**各自出现在正确的地块内**，无穿模、无悬空错位 |

**一处我自己加的检查当场抓到了错**：我先把 `model.station.meeting` 映射到 `tableCross.glb`，
但**那个文件我没 vendor**；而且它 2.03 宽（放大后 3 米）会**压到隔壁站点**（两个会议站点只隔约 2.5）。
换成 `table.glb` 并补进白名单。这条"内容引用的文件必须在 vendor 里"的检查
（R19 加的）在这一轮第二次救场。

### 诚实说缺口：31 个家具文件里**只有 6 个被引用**

视觉核对明确指出来："**没有椅子**——人看起来像是直接坐在空气里"、"**没有植物**"。

原因是结构性的：**一个站点目前只能声明一个模型**（`SceneProp.modelId` 是单数），
所以"书桌 + 椅子 + 显示器"这种组合摆不出来。另外 25 个文件（椅子×4、显示器/键鼠、
笔记本、书架×3、台灯×3、衣帽架、门框×2、扶手椅、封口纸箱、垃圾桶、收音机、电视、植物×3）
**已经 vendor、已经在白名单里，但没有任何内容引用它们**。

这正是我在 R12 批评过的"**链路建好了没有消费者**"，所以**必须写下来**：
已记成 **M4-11（站点组合道具）**，见 BACKLOG。355KB 的体积可以接受，
但**下一轮该让它们被用上，否则就该裁掉**。

### 下一轮从哪继续

**M4-11：让一个站点能摆一组模型（椅子 + 显示器 + 植物）。** 具体：

1. `SceneProp` 加 `extraModelIds: string[]`（协议层），`scene/plan.ts` 从内容填；
   或者更通用：`StationEntry.models: string[]`（内容声明一组）。
   两者的取舍：前者是"渲染层的多模型"，后者是"内容的多模型"——**倾向后者**
   （组合是内容决策：这张桌子上有没有显示器是内容说了算，不是渲染器）。
2. 内容侧给 6 个站点各声明一组（例如书桌 = `desk` + `chairDesk` + `computerScreen` + `laptop`）。
3. 渲染器按 `modelId` 逐个实例化并**错开摆放**（需要每个模型一个局部偏移 → 这又回到
   "偏移量该进内容还是机制"的老问题：**单个模型的偏移是内容**（"显示器摆在桌面上"),
   而"摆正/贴地"是机制）。
4. 之后再接 **M5-2（动作库）**：32 条剪辑 → `AnimationMixer` + 按状态交叉淡入。
   第一件事仍然是**把 GLB 里真实的 32 个剪辑名 dump 出来**，不凭印象写。

### 假设

- **办公室场景就照 Microverse 的"设计意图"来**（工位区 / 会议区 / 储物区 / 休息区），
  但**不碰它的素材**（2D 像素、且许可不明）。我们的家具全部来自 Kenney CC0。
- **`scale: 1.5` 对全部家具有效**：Kenney 的 kit 内部是统一单位约定（实测三个不同类型的高宽比一致）。
- **自动摆正（`recenterOnGround`）对角色是无操作**：它们的包围盒本来就居中且脚底在 0——
  所以这个函数不需要"要不要启用"的开关。**但这依赖 Kenney 的约定**；换一家素材时
  如果模型原点在奇怪的地方，这个函数仍然会把它摆正（那正是它通用的一面）。

### 卡住 / 风险

- **31 个家具文件里 25 个还没有消费者**（见上）。这是本轮唯一的"半成品"，已记 M4-11。
- **`vendor` 目录现在 4.1MB**（three 1.0MB + 角色 2.9MB + 家具 0.36MB）。再加包就要考虑按需下载。
- **`web/` 仍是手写 JS 没有类型**（记到第九次）。这一轮又给它加了 `recenterOnGround`。
- **站点仍然只有一个模型**，所以"坐"这个动作在视觉上是缺失的（人站在桌子后面对齐 slot）。
- **定时任务仍然取消着**，下一轮什么时候做由用户说。

### 本轮产出

- 新增：`src/vendor/kenney-furniture/`（32 个文件）、`src/content/packs/kenney-furniture.ts`
- 修改：`src/routes/vendor.ts`（白名单 +31）、`src/content/packs/default.ts`（注册表现包）、
  `web/scene3d.js`（`recenterOnGround` + 调用）、
  `test/{external-pack,http,smoke,vendor,kenney-pack}.test.js`
- 文档：`BACKLOG.md`（M4-11 新增）
- 测试仍 286/286；**没有新增测试**——这一轮靠已有测试抓新情况

---

## R19 — 2026-10-15 · GLB 真的跑起来了：Kenney 角色进场景（M5-1 / M5-5 / M5-6）

### 这一轮兑现了什么

3D 小镇里的**人从「胶囊占位」变成了真的低模角色**——12 个 Kenney CC0 角色里的一个，
每个 GLB 内嵌 32 条动画（把动画接进来是 M5-2）。

而且这一步**换资产没有改动任何代码的「知识」**：内容包只说了一句话
（「`model.agent.base` 是那个 GLB」），渲染器只是从计划里读到「这个是 GLB，url 是这个」。

### 做了什么

**1. `web/model-loader.js`（新）——本包第一个异步的东西**

异步带来三个只在这一层能管的问题，逐个处理并**都写成测试**：

| 问题 | 处理 | 不处理的后果 |
|---|---|---|
| 同一个模型被要很多次（12 个角色共用一个 GLB） | 按 url 去重，只发一次请求 | 12 次下载 |
| `applyWorld` 每帧都在跑 | **失败被记住**，只有显式 `retry()` 才重发 | 一个 404 变成每秒 60 次请求 |
| 用户可能已经换过快照 | 到货时**先检查占位块还在不在场景里**（`parent === null` 就丢掉） | 往一个废弃的组里挂东西，或者位置停在原地 |

**并且刻意分开两件事**：**灰蓝 = 还在加载**，**品红 = 出错了**。混成一种颜色的话，
「还没到」会被读成「坏了」，而「坏了」会被一直等下去。

**2. `scene3d.js`：同步造形状 → 异步加载 + 到货替换**

关键细节两条：`SkeletonUtils.clone()`（**不是** `Object3D.clone()`——后者共享骨架，
12 个角色会同步抽搐）；每个实例**克隆一份材质**（`cloneSkinned` 会共享材质，
改一个会改到所有人）。

还改掉一处对真模型不成立的旧逻辑：原来「在干活时把 `scale.y` 压到 0.82」用来区分姿态——
对胶囊是好事，**对真模型就是把人在竖直方向压扁**。现在只对程序化几何做。

**3. `pack.kenney-mini`（新内容包）——只做了 `overrides` 这一件事**

```
overrides: ['models/model.agent.base']
→ { kind: 'glb', url: 'kenney-mini-characters/character-male-a.glb', clipSource: true }
   scale: 2   // 模型自然高度 0.671（实测自 GLB 的 POSITION 访问器 min/max），放大到约 1.34
```

`scale: 2` 不是我猜的：解析 GLB 的 JSON chunk 得到 `y 0.000..0.671`、脚底在 y=0、无节点缩放，
乘 2 之后与镇上的桌椅（约 0.5 高）成比例。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 286 / pass 286 / fail 0
```

271 → **286**（`test/model-loader.test.js` 10 条 + `test/kenney-pack.test.js` 6 条）。

**M5-6 的验收口径是「模拟内核零改动」——这句必须用 diff 证明，不能只是说**：

```
✅ src/sim/ 与 src/domain/ 一个文件都没改
   本轮改动：3 个 web/（渲染器）、2 个 src/content/packs/、7 个 test/
```

准确说清「零改动」指什么：**`src/sim/`、`src/domain/`、`src/world/`、`src/scene/`、
`src/protocol/`、`src/routes/` 全部零改动**——世界模型、场景描述层、协议、HTTP 层
对「角色换成 GLB」**毫无感知**。渲染器改了，但那是**新机制**（GLB 加载以前根本不存在）；
如果只是把这个 GLB 换成另一个 GLB，渲染器一行都不用动。

**最值钱的一条新测试**（`kenney-pack.test.js`）：

> **内置内容里声明的每个 GLB 地址，都必须在 `src/vendor/` 下真的有那个文件。**

这两处**没有任何编译器关系**——少一个文件、或路径写错一个字符，运行期的表现是
「角色变成占位块」，而没有任何错误信息指向「文件没发出去」。这条把它变成一个测试失败。

**浏览器实测**（真链路）：

| 检查 | 结果 |
|---|---|
| GLB 真的下载了吗 | `vendor/kenney-mini-characters/character-male-a.glb`（**只请求 1 次**，12 个角色共用） |
| 外部贴图跟随了吗 | `vendor/kenney-mini-characters/Textures/colormap.png` —— GLTFLoader 自己按相对路径找到了它（R18 保留目录结构的决定在这里兑现） |
| 占位残留 | **灰蓝 0 像素、品红 0 像素** —— 全部换成了真模型 |
| 视觉确认 | 用视觉模型读截图：**8 个立体低模人形**，有头/躯干/四肢，站在地面上、有投影、不悬空不陷地，比例与桌椅协调 |
| 3D 画面 | 1377 种颜色、20.5% 非黑 |

**一条测试是我写错了、实现是对的**：我最初断言「显式 `retry()` 之后仍失败也不该再报」。
想想不对——**`retry()` 是人的动作**，它的失败必须报出来；静默失败比日志多一行难查得多。
要避免的是「每帧报一次」。改了断言并把这条推理写进了测试注释。

### 下一轮从哪继续（不再自动开轮）

**M5-2：接上 `actions` 库**，那才是完整的「动作库」（你最初点名的四个库之一）。
GLB 已经在内存里带着 `animations: 32` 了（`scene3d.js` 里我把它挂在
`real.userData.animations` 上，就等这一步）：

1. `actions` 库条目 → `{ state: AgentState, clip: string | null }`（库的形状已经有了，
   内置包里现在是 `clip: null` 的占位）；
2. `pack.kenney-mini` 再 `overrides` 掉 `actions/*`，把 `clip` 指到 Kenney 的真实剪辑名；
3. `scene3d.js` 为每个角色建 `AnimationMixer`，按 `agent.state` 交叉淡入切换
   （**先查剪辑在不在**：不在就报错并**列出这个 GLB 实际有的剪辑名**——这是 M1.6-7b 那条欠账）；
4. R13 定的规矩照样适用：**同一状态有多个动作时用 seeded 随机挑**，别让人同步得像机器人。

在那之前先想清一件事：**剪辑名从哪来**。32 个名字写死在 `actions` 库里是「内容」，
但它们必须与 GLB 里真实的名字对得上——而这**又是一处没有编译器关系的地方**
（和本轮那条 url 测试同类）。所以 M5-2 的第一件事是：**把 GLB 里真实的 32 个剪辑名 dump 出来**，
再据此写内容，而不是凭印象写。

### 假设

- **12 个角色只用一个**：让 8 个 agent 长得不一样需要「角色模型列表 + 按序分配」这个新概念，
  **故意没混进这一轮**（已记成 M5-7）。这一轮的目标是「GLB 能跑起来」。
- **每个实例克隆材质**：代价是 12 份材质对象，换来「改一个不影响别人」——将来要按角色配色就靠它。
- **不缓存已加载的模型实例，只缓存解析结果**：实例必须每份独立（骨架/材质），
  缓存共享的「模板」由 `SkeletonUtils.clone()` 负责克隆。
- **`pack.kenney-mini` 是内置包**（默认装载）：所以默认小镇就是真角色。想退回程序化角色，
  把它从 `builtinPacks()` 里去掉即可——原条目仍在提供方链上做回退（有测试钉住）。
- **孤儿构建器检查改成看「各个包声明了什么」**：`pack.kenney-mini` 覆盖掉 `model.agent.base`
  之后，`avatar` 在合并后的注册表里没人引用了。但 `avatar` **不是死代码**——基础包仍声明它，
  而且它是「没装表现包 / GLB 加载失败」时唯一的角色形状。用合并后的注册表来判「有没有人用」，
  等于让**一次合法的覆盖**把基础包的实现诬告成死代码。

### 卡住 / 风险

- **`actions` 库与 GLB 里的剪辑名对不上时不会有任何编译期提示**（M5-2 要处理，
  办法是加载后校验并**列出可用的名字**）。
- **`web/` 仍是手写 JS 没有类型**（记到第八次了）。这一轮又给它加了一个异步模块。
  它现在是本包**唯一**没有类型检查的地方，而它吃的形状（`ScenePlan` / 事件载荷 / GLB 加载结果）
  已经有四类了。
- **GLB 加载只有「能/不能」两条路**，没有进度、没有超时。模型一大就会变成长时间占位
  （现在 247KB 无所谓，将来 Kenney Furniture Kit 4.89MB 就要考虑）。
- **定时任务已取消**，「下一轮什么时候做」由你说。

### 本轮产出

- 新增：`web/model-loader.js`、`src/content/packs/kenney-mini.ts`、
  `test/model-loader.test.js`、`test/kenney-pack.test.js`
- 修改：`web/scene3d.js`（异步加载 + 到货替换 + 只对程序化几何压扁）、`web/app.js`（资源失败单独报）、
  `src/content/packs/default.ts`（注册表现包）、`test/{builders,external-pack,http,scene-plan,smoke}.test.js`
- 文档：`ARCHITECTURE.md`（决策 D33）、`BACKLOG.md`（M5-1/5/6 done、M5-2 转 ready、M5-7 新增）
- 测试从 271 → 286

---

## R18 — 2026-10-15 · Kenney CC0 角色资产入库 + three 加载器就位（M5 的前提）

### 两件事先记在最上面

1. **用户要求取消定时任务——已取消**（`schedule-2d55592d…`）。此后不再自动开轮。
2. 取消时工作区里有**半成品**（我把 `src/vendor/three/` 重排了，但白名单与 import map 还指着旧路径，
   3D 视图此时是坏的）。**已收尾到全绿再停**，没有把坏状态留给用户。

### 本轮做了什么

**1. 去掉了"为一个关着的开关升级 three"这件事（M4-9 暂停，理由已量过）**

原计划是换 three 0.167.1 → 0.186.1 好接 bloom。动手前查了主题内容：

```
post: { toneMapping: 'ACESFilmic', exposure: 1.05, bloom: { enabled: false, … } }
```

**`enabled: false`**——当前美术就是暖色纸感等距，bloom 是关的。而升级的代价是
**+2.2MB**（0.186 起 `three.module.js` 与 `three.core.js` 分成两个文件，且**没有 min 版**）。
为一个关着的开关付这个代价不划算。**判决与代价都写进了 BACKLOG 的 M4-9**，哪天主题要开 bloom 就能直接用。

**2. 改做价值更高的那件：M5 的资产（它对应你一开始点名的"动作库"）**

按 `docs/ASSETS.md` 已经核验过的选型（**不重新调研**）下载 Kenney "Mini Characters"：

- 直链 `https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip`
- 许可证 **CC0**（`License.txt` 原文入库，"无需署名"字样一并核对过）
- **只 vendor 12 个角色**，没要整包里的 14 个辅具/轮椅（用不到；CC0 允许只取一部分）

**并且逐个解析了 GLB 的 JSON chunk 来验**（不是"看着像"）：

| 项目 | 实测 |
|---|---|
| 每个角色的动画数 | **32**（`idle`/`walk`/`sprint`/`sit`…） |
| 蒙皮数 | **2**（已绑定骨骼） |
| 外部依赖 | **`Textures/colormap.png`**（8.5KB，12 个角色共用） |
| 体积 | 12 个角色合计 **2.9MB**（单个 237–273KB） |
| 整包 zip | 2,403,059B，sha256 `9e1d48e6…d0999` |

**3. 顺带把 three 的加载器也 vendor 了**（M5-1 的直接前提）
`GLTFLoader.js` / `BufferGeometryUtils.js` / `SkeletonUtils.js`——`SkeletonUtils.clone()` 是
**克隆骨骼角色的唯一正确做法**（直接 `Object3D.clone()` 会共享骨架，12 个角色会同步抽搐，
见 `REFERENCES.md` §6.4）。

**4. 目录结构刻意与上游一致**（这是本轮的设计决定，记成决策 D32）

`GLTFLoader.js` 里有 `import '../utils/BufferGeometryUtils.js'`——**拍平一层这个相对路径就断了**，
而"改 vendored 代码"是我不做的事（改了 sha256 就失去意义，而 sha256 正是"这份代码确实是我核对过的那份"的唯一凭据）。
所以：

```
src/vendor/three/build/three.module.min.js
src/vendor/three/examples/jsm/{controls,loaders,utils}/*.js
src/vendor/three/LICENSE
src/vendor/kenney-mini-characters/{License.txt, Textures/colormap.png, 12 × *.glb}
```

import map 相应改成 three 官方文档的写法：`"three"` + `"three/addons/"` 前缀映射。

白名单从"文件名→MIME 的映射"改成**确切相对路径数组 + 按扩展名给 MIME**：让"哪些能服务"
（安全边界）与"以什么类型服务"（协议细节）成为两个独立问题。**穷举性没降低**——认的是确切路径，
不做任何拼接猜路径。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 271 / pass 271 / fail 0
```

270 → **271**。新增的测试里有两条是真有价值的：

- **磁盘 ↔ 白名单双向核对**（递归）：文件进了 `src/vendor/` 却忘了开路由 → 运行期 404，
  而那时你在看别的错误。反过来白名单里有、磁盘上没有 → 必然 404。
- **GLB 必须带齐它引用的外部贴图**：直接解析 GLB 的 JSON chunk 读出 `images[].uri`，
  再断言那个文件在 vendor 里。少它的表现是"模型加载成功但一片纯色"——最难查的一种半成功。
  同一条测试顺带把"32 条动画 + 有蒙皮"这两个前提**钉死了**（它是 `actions` 库的资产依据）。

**测试抓到了一个我看不出来的真 bug**：白名单新增 `three/LICENSE`（**没有扩展名**），
而取扩展名的表达式是 `name.slice(name.lastIndexOf('.'))` → 对 `three/LICENSE` 切出 `"E"` →
这个白名单文件**一被请求就 500**。已抽成 `extensionOf()`（两处共用，测试也直接打它），
无扩展名按 `text/plain` 发。

**真实 HTTP 路由逐个核对过**：4 个 three 文件 + LICENSE + GLB + 贴图 + Kenney License 全 **200**；
`README.md`（不服务的）**404**；三种越界尝试（`../`、`a/../../`、编码斜杠 `%2f`）全 **404**；
GLB 的 `Content-Type: model/gltf-binary`、魔数 `glTF`、246,916B。

**浏览器实测**（重排 import map 是最容易静默失效的地方）：

| 检查 | 结果 |
|---|---|
| `import('three')` | **418 个导出** |
| `import('three/addons/controls/OrbitControls.js')` | function |
| `import('three/addons/loaders/GLTFLoader.js')` | **function**（新） |
| `import('three/addons/utils/SkeletonUtils.js')` | **`clone` 是 function**（新） |
| 3D 画面 | 1685 种颜色、20.5% 非黑、**0 品红像素**——与重排前**完全一致**（没弄坏） |

### 下一轮从哪继续（不再自动开轮，等你说）

**M5-1 + M5-5：真正把 GLB 用起来。**

1. `web/scene3d.js` 的 `instantiate()` 现在是**同步**的，GLB 要**异步**加载 → 需要一个
   `Map<url, Promise<GLB>>` 缓存 + "模型到货后再摆上去"的路径（`applyWorld` 每帧都在跑，天然适合）。
2. 加载后 **`SkeletonUtils.clone()`**（**不是** `Object3D.clone()`——会共享骨架）。
3. 新增 `pack.kenney-mini`：显式 `overrides: ['models/model.agent.base']`，把程序化 `avatar`
   换成 `{ kind: 'glb', url: 'kenney-mini-characters/character-male-a.glb' }`。
   **`url` 相对本插件资源根**（决策 D32），渲染器按 `./<url>` 解析。
4. **M5-6 是验收点**：加了这个包之后 `pnpm test` 仍全绿、且**模拟内核零改动**。
   在那之前，"换资产只改内容"不算已验证。
5. 之后再接 `actions` 库（32 条剪辑 → `AnimationMixer`），那才是完整的"动作库"。

### 假设

- **只 vendor 12 个角色而不是整包**：CC0 允许任意取舍；辅具/轮椅本场景用不到。要加随时能补（直链与 sha256 都记着）。
- **`Textures/colormap.png` 是共享贴图**：12 个角色引用同一个文件，所以只 vendor 一份。
- **不 vendor `three.core.js`**：那是 0.186 才有的拆分；我们仍在 0.167.1（单文件 min 版），M4-9 既然暂停就保持一致。
- **白名单用数组而不是映射**：MIME 由扩展名决定，于是"能服务哪些"与"以什么类型服务"分开。

### 卡住 / 风险

- **vendor 目录现在 3.73MB**（three 1.0MB + 角色 2.9MB）。这是有意的代价，但值得知道：
  **再来两个 Kenney 包就会到 10MB 量级**，届时应该考虑"资产包按需下载"而不是继续 vendor。
- **GLTFLoader / SkeletonUtils 已 vendor、已可达，但还没有任何代码消费它们**——
  这条我写在了 `src/vendor/README.md` 最显眼的"还没做的事"一节里，
  因为"链路建好了没有消费者"正是我在 R12 批评过的形态。**它们必须在下一轮被用起来。**
- **`web/` 仍是手写 JS 没有类型**（R10 记到第七次）。本轮又给它加了一个 import map 契约。
- **定时任务已取消**，所以"M5 什么时候做"由你决定，不再有每小时的推进。

### 本轮产出

- 新增：`src/vendor/kenney-mini-characters/`（15 个文件）、
  `src/vendor/three/examples/jsm/{loaders/GLTFLoader.js, utils/BufferGeometryUtils.js, utils/SkeletonUtils.js}`
- 移动：`src/vendor/three.module.min.js` → `three/build/`、`three.OrbitControls.js` → `three/examples/jsm/controls/`、
  `LICENSE.three` → `three/LICENSE`
- 修改：`src/routes/vendor.ts`（嵌套白名单 + `extensionOf` + MIME 表）、`web/index.html`（import map）、
  `web/scene3d.js`（说明符）、`src/vendor/README.md`（20 个文件逐个 sha256 + 许可 + 还没做的事）、
  `test/{vendor,builders}.test.js`
- 文档：`ARCHITECTURE.md`（决策 D32）、`BACKLOG.md`（M4-9 暂停并记下代价、M5-1/M5-5 记上前提已就位）
- 测试从 270 → 271

---

## R17 — 2026-10-15 · 外网回来了：第一次真去 GitHub 搜索（M4 的研究任务）

### 先说最重要的一件事：网络通了

第 11 次检查（每轮都做）返回的是 **`403` 而不是 `000`**。这不像"还断着"——更像
"有人应答了但不满意我的请求"。加一个 `User-Agent` 再试：**`api.github.com` 200，搜索真的出结果。**

```
403 → 200   api.github.com（带 User-Agent）
200         registry.npmjs.org / unpkg.com / example.com
```

**这解开的是三件事**（不只是"能搜东西"）：M5 的 Kenney 资产、three 换 0.186.1（bloom 立刻可用）、
以及**用户从最开始就要我做的那件事**——去 GitHub 找现成的游戏场景。
（R9–R16 十次 `000` 期间我把这条一直挂在每轮汇报里，现在它不再是阻塞了。）

### 本轮做的是研究：真的去搜了，并且逐个核实

按 `docs/REFERENCES.md` 第三节自己定的两条硬标准来筛（许可证宽松；能喂数据而不是烘死布局），
**逐个核对了许可证与文件内容**，不是转述搜索结果。写进了该文档的新增第六节。

**结论要直说：没有"能直接拿来当场景数据"的现成项目。** 两个最对口的候选，布局都烘在代码里。

| 项目 | ★ | 许可证 | 判决 |
|---|---|---|---|
| `Khalidabdi1/factory` | 133 | **MIT** | **借鉴**（结构可适配，布局不能喂） |
| `MrBongoC/ai-iso-skill` | 182 | **MIT** | **借鉴**（发丝等距的美术内核，短到能整段读透） |
| `jeromeetienne/threex.proceduralcity` | 145 | MIT | 仅参考（three r60 时代，API 早过期） |
| `StarKnightt/night-street` | 129 | MIT | 仅参考（R3F 外壳） |
| `VisualSource/selectiveUnrealBloomPass` | 3 | MIT | bloom 的备选实现 |

但搜到的东西**比预期有用**，两个原因：

**① `factory` 的分层与我们自己独立选的几乎同构**——`yard/kernel`（等距内核）/
`yard/models`（13 个几何构建器）/ `yard/world`（24 个按区域分的场景定义）/ `yard/theme.ts` /
`yard/sim`。这跟我们 R16 才定下的 `builders.js` + `ScenePlan` + 内容库是**同一个思路**。
一次外部验证，不是巧合的相似。

**② 它的等距内核短到可以直接读透**，而且手法值得抄：

```ts
export const W = (x, y, z = 0) => new THREE.Vector3(x, z, y)   // 换 y/z：three 是 y-up
export const plane = (O, U, V) => { …makeBasis(u, v, n).setPosition(W(...O)) }
export const FRONT = (x,y,z) => plane([x,y,z], [1,0,0], [0,0,-1])
```

**任何东西（矩形、文字、路径）画在 `(u,v)` 平面上，靠一个基矩阵就落到正确的等距面；
深度靠绘制顺序解决。** 它的上游 `ai-iso-skill` 更极端：**纯 SVG + 约 15 行投影，零依赖**，
每个盒子面变成一幅 SVG `matrix()`。

所以"能用 GitHub 上的东西"最实在的形态不是**搬场景**，是**搬内核**——
而决策 D23（`ScenePlan` 与渲染器无关）正好就是为这件事留的缝。

**不能直接用的原因也写清了**：`factory` 的 `buildFlats(name, x, y, w, d, h, door)` 坐标是参数，
但**调用点把坐标写死在代码里**——它是"一个做好的小镇"，不是"给数据就摆"的引擎。
另外它 75 个 `.ts` 里很多带 `// @ts-nocheck`：借结构可以，借代码要重写。

### 第三节那三块硬骨头，现在的答案

| 缺什么 | 结论 |
|---|---|
| **骨骼动画** | 最该读的是 **three.js 官方** `webgl_animation_skinning_blending.html` / `_ik.html` / `examples/jsm/utils/SkeletonUtils.js`（三个都实测 200）。**关键**：`SkeletonUtils.clone()` 是克隆骨骼角色的唯一正确做法——直接 `clone()` 会**共享骨架**，24 个角色同步抽搐 |
| **SDF 文字** | `troika-three-text`（本机 0.49.1，最新 0.52.5，MIT）；用法看 `lojjic/aframe-troika-text` |
| **后处理 / bloom** | 官方 `webgl_postprocessing_unreal_bloom_selective.html`（200）。**`postprocessing` 最新 6.39.5，许可证是 Zlib**——宽松且与 MIT 兼容，但**不是 MIT**，按第三节第一条我显式记成了"经核对的例外" |

版本情报（实测 npm registry）：`three` **0.186.1**（我们 vendored 0.167.1）、
`postprocessing` 6.39.5、`troika-three-text` 0.52.5、`three-stdlib` 2.36.1。

### 下一轮从哪继续（联网后按价值排序）

1. **M4-9：换 three 0.167.1 → 0.186.1 + 引入 `postprocessing` → 接上 bloom**。
   主题里的 `post.bloom.enabled` 从 R10 留到现在没人接（0.167.1 差一个 minor 进不去 peer）。
   纯替换：换 `src/vendor/` 三个文件 + 更新 sha256 + 新增 vendored 依赖。
2. **M5：真拿 Kenney 的 CC0 角色资产**（`docs/ASSETS.md` 已核验过那批），
   接 `SkeletonUtils.clone()` + `AnimationMixer`。这是"换资产只改内容"的唯一真实验证点（M5-6）。
3. **M4-10（要用户拍板）**：发丝等距作为**第二种视图**——消费同一份 `ScenePlan` 的第二个渲染器。
   这是我倾向的方向（决策 D23 的第二次兑现），但它是美术方向的岔路，不该我一个人定。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 270 / pass 270 / fail 0
```

本轮**没有改代码**（研究轮），所以测试数与 R16 相同：**270/270**。改的是
`docs/REFERENCES.md`（新增第六节）与 `docs/BACKLOG.md`（M4-9 / M4-10）。
**这一轮的可验证产出就是那份核对过许可证与文件内容的参考清单**——
它的价值全在"核对过"三个字上：每条判决后面都能指到具体文件或具体 HTTP 状态码。

另外把该文档开头那段已经过期的"这台机器完全没有外网"改成了事实（并保留了断网期的结论，
因为第三、四、五节的所有判断都是在那十轮里做的，且**它们没有因为联网而失效**）。

### 假设

- **`403` 就是"网络回来了"的信号**：GitHub 的 API 对没有 `User-Agent` 的请求返回 403。
  这条值得记——**断网与"被拒绝"在 `curl` 里长得完全不同**（`000` vs `403`），
  而我一直只看"是不是 `000`"。前几轮如果带上 UA 试一次，可能早就发现通了。
- **`postprocessing` 的 Zlib 可以接受**：Zlib 比 MIT 更宽松、与之兼容。
  但它是**这条筛选标准上的第一个例外**，所以记在文档里而不是默默放行。
- **`factory` 的"借鉴"是结构级的**：`kernel/models/world/theme` 这个切分可以照搬，
  代码不行（`@ts-nocheck`、Next.js 外壳、布局写死）。

### 卡住 / 风险

- **联网后的第一个诱惑是"顺手把 M5 也做了"**。没做：一轮只做一件能做完且能验的事，
  而研究本身要看的东西（许可证、文件、版本、上游项目）已经够多了。
- **`unpkg.com` 能通但没验过能装 npm 包**：下一个真正要下载的依赖是 `postprocessing`，
  而**根 `pnpm install` 是坏的**（`packages/dsh-daily` 的过期 RC 钉死，用户正在那条线上干活，
  我不能碰）。所以 M4-9 需要一条**绕过根 workspace** 的取包路径——下一轮第一件事就是确认这条路。
- **搜索只做了仓库级**：GitHub 的代码搜索需要认证，所以"某个仓库里具体怎么用
  `SkeletonUtils.clone()`"这种问题现在只能靠读官方 example。够用，但不是万能。
- **`web/` 仍是手写 JS 没有类型**（R10/R13/R14/R15/R16 记到第六次了）。
  这一轮没动代码所以没加剧，但这仍是我欠得最久的一笔账。

### 本轮产出

- 文档：`docs/REFERENCES.md`（新增第六节：核对过的 GitHub 候选、三块硬骨头的答案、版本情报、下一步排序）、
  `docs/BACKLOG.md`（新增 M4-9 可做、M4-10 待拍板）
- 无代码变更；测试仍 270/270

---

## R16 — 2026-10-15 · 模型选择变成内容（M4-7）：构建器注册表

网络第十次确认仍断。取 M4-7——R15 说它是"当前 3D 最假的地方"。

### 查下去发现的问题比"加个注册表"严重

R15 我记的是"站点是方块、角色是胶囊，形状写死在 `scene3d.js` 里"。动手时先看 `scene/plan.ts`，
发现这一行：

```ts
modelId: `model.station.${s.kind}`   // ← 代码拼接出来的模型 id
```

**等于把模型清单写进了代码**，内容里的 `models` 库**根本没人读**。而且它坏得很安静：
内容里把某个站点换成别的模型、或者某个 kind 的模型另有其名，代码就会指向一个**不存在的模型**，
而 `models` 库看起来完全正常。这正是"代码是机制，内容是数据"那条红线被踩的样子。

所以这一轮做的是**三件事**，不是一件：

1. **模型选择变成内容**：`StationEntry.model`（每个站点声明）与 `SceneEntry.agentModel`（场景声明角色模型）
   成为必填字段；`ScenePlan` 新增一张 `models` 表（**只含本场景用到的**），
   `SceneProp.modelId` 与 `SceneActor.modelId` 都能在表里查到。
   渲染器**不再去内容库里找模型**——它只需要 `ScenePlan`。
2. **构建器注册表**（`web/builders.js`）：8 个程序化构建器（`avatar`/`desk`/`meeting`/`server`/
   `mailroom`/`lab`/`breakroom`/`delivery`），每个返回一个**底面贴地**的 `Object3D`。
   按 **builder 名**注册（而不是按 model id）——按 id 注册的话，新增一个模型条目仍要改代码来"认领"，等于没改。
3. **缺失要说出来**：内容引用了一个没有实现的构建器时，画**品红占位块**并把名字交给面板，
   **不静默退回方块**——退回的效果是"画面上有个东西但显然不对"，而真正的原因完全看不见。

按领域契约的分工：`domain` 只把 `Station.model`／`World.agentModel` 当**不透明字符串**带着；
`content` 负责把条目映射成 `SceneModel`（只有它知道 `ModelEntry` 的形状）；
`scene` 负责组装计划；渲染器只认计划。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 270 / pass 270 / fail 0
```

260 → **270**（`test/builders.test.js` 7 条 + 场景规划的模型表 3 条）。

其中**最重要的一条**是内容与渲染器之间的契约：

> 内置内容里声明的**每一个** `builder` 名，注册表都得有；反过来注册表里也不该有没人用的孤儿。

这条断言把"加一个模型条目完全不用改代码"从口号变成了**可验的事实**。
反例也测了：用一个外部包把 `station.desk-a` 换成**完全不同命名**的 `model.custom.pod`，
计划必须跟着变——如果代码还在拼 `model.station.${kind}`，这条就红。

**构建器能在 node 里真测**（这是设计成注入 `THREE` 的原因）：three 的几何不需要 WebGL 上下文，
所以直接 import vendored 的那份就能建出真的 `Object3D`，逐条检查
**包围盒非空**、**底面贴地（y≈0）**、**颜色来自参数**（换颜色必须换出不同材质——
这条专门抓"色值写死在构建器里"）、**多实例互不影响**。

**浏览器实测**：

| 检查 | 结果 |
|---|---|
| 有没有品红占位块 | **0 品红像素** → 所有构建器都解析出来了 |
| 形状是否真的变多 | 颜色数 **788 → 1685**（同样的相机与光照，形状更复杂） |
| 非黑像素 | 20.5% |
| 错误提示 | `#view-hint` 为空 |
| 两个视图 | 3D 与俯视来回切，花名册 8 行 / 工单 10 行正常 |
| 接口 | `plan.models` 正好 **7 条**（6 种站点模型 + 1 个角色模型），构建器名都解析出来了 |

**浏览器验证抓到了一个我自己的真 bug**：我删掉了 `ACTOR_Y` 常量（形状不再由代码定尺寸），
但 `applyWorld` 里还在用它定位角色 → `ReferenceError` → **画布全黑（1 种颜色、0% 非黑）**。
这个 bug 单测抓不到（`scene3d.js` 是浏览器模块），是"取一帧像素 + 看提示"抓到的。
顺带修了一处语义错误：新写法**只改角色的 x/z，不动 y**——y 由构建器决定，
而旧写法按写死的常量把人抬到半空。

### 一处**破坏性的内容变更**（必须记）

`StationEntry.model` 与 `SceneEntry.agentModel` 是**新增必填字段**。后果：

- 内置包已补齐（10 个站点 + 1 个场景）；
- `schemaVersion` 仍是 1，**没有加版本门**——也就是说一个按旧规范写的外部包会在校验时报
  "站点模型 id 必须是非空字符串"，而它能照做的动作是**加一个 `model` 字段**，报错文案里应该能看出来。
- 这也是"手上还没有任何外部内容包"这个事实带来的便利。**等真有第三方包了，这类变更必须走 schemaVersion 与迁移说明。**

### 下一轮从哪继续

**M4 的可做部分做完了**（M4-7 是最后一条不依赖联网的）。剩下的都卡在外部条件上：

1. **M4-7b / M5**：GLB 加载与骨骼动画。**需要联网**拿 `pack.kenney-mini`（`docs/ASSETS.md` 已核验过那批资源）。
   代码侧现在会诚实地报「（GLB）xxx」并画品红块，不会假装加载成功。
2. **M3-1b**（`events.jsonl` 分片）：**我仍然不主动做**——"错误的分片比不分片更难改"。
3. **M2.6-1**（消息文案进不进内容库）：要用户拍板。

所以下一轮如果没有外部条件变化，我会**明确报告"没有可做的活了"**，
而不是为了产出而产出。**网络恢复是唯一的解锁条件**（three 换 0.186 后 bloom 立刻可用，
主题侧开关已留好）。

### 假设

- **按 builder 名而不是 model id 注册**：这是这轮的关键设计选择，理由写在 `builders.js` 的文件头。
  代价是"内容里两个模型条目指向同一个 builder 时长得一样"——但那是**内容的意图**，不是缺陷。
- **构建器返回底面贴地的 Object3D**：让摆放逻辑（x/z）与形状逻辑完全分开，
  于是"这个桌子多大"也由内容的 `scale` 说了算。测试逐条验了 `y≈0`。
- **GLB 分支现在就报错**：比"静默画方块"好。M5 落地前，品红块是正确行为。
- **`SceneModel.url` 已过路径校验**（M1.6-7 那套），所以 M5 拿到它时不用再防穿越。

### 卡住 / 风险

- **网络第十次确认全断**。M5 与 three 0.186.1（bloom）都等它。
- **破坏性内容变更没有版本门**：见上面那一节。有第三方包之前必须补上。
- **`web/` 仍是手写 JS 没有类型**（R10/R13/R14/R15 记到第五次了）。
  这一轮它又多吃了 `SceneModel` 与 `ScenePlan.models` 两个形状。**下一次动 `web/` 就该改成 TS**。
- **3D 只在 2112×1403 的高分屏上验过**，没验窄窗口下的正交视锥。
- **品红占位块只在浏览器里验过**（0 像素），**没有单测**——`onMissing` 那条路径没被自动化覆盖。

### 本轮产出

- 新增：`web/builders.js`、`test/builders.test.js`
- 修改：`src/content/kinds.ts`（`StationEntry.model` / `SceneEntry.agentModel`）、
  `src/domain/types.ts`（`Station.model` / `World.agentModel`）、`src/content/instantiate.ts`、
  `src/content/port.ts`（`modelOf`）、`src/protocol/scene.ts`（`SceneModel` / `models` / 角色 `modelId`）、
  `src/protocol/ports/content.ts`、`src/scene/plan.ts`（不再拼接 id）、`src/routes/api.ts`、
  `src/world/create.ts`、`src/content/{validate,registry}.ts`（形状 + 交叉引用）、
  `src/content/packs/default.ts`（11 处声明）、`web/{scene3d,app}.js`、
  `test/{content,external-pack,scene-plan}.test.js`
- 文档：`ARCHITECTURE.md`（决策 D31）、`BACKLOG.md`（M4-7 done、M4-7b 新增）
- 测试从 260 → 270

---

## R15 — 2026-10-15 · M4 开动：3D 视图跑起来了（走"路 B"）

**我不再空等路线拍板，直接走了路 B**（用本机那份 `three@0.167.1`）。
理由：它是**可逆的**——就是一次文件复制 + 一份 sha256 记录；将来换 0.186 只需换文件。
而停在原地等，产出是零。网络第九次确认仍断（`api.github.com` = `000`）。

### 做了什么

**1. 按仓库既有约定 vendor（不是我自己发明一套）**

先读了仓库根的 `docs/DIRECTORY.md`——它**已经**有 vendoring 约定，参照实现是
`packages/dsh-contract-butler`：源在 `src/vendor/`（入库）→ 构建同步到 `lib/vendor/` →
宿主白名单路由。我第一版放进 `web/vendor/` 是**偏离**，已按约定改回来。

一处**为共存让路的有理由偏离**：约定的宿主路径是 `GET /vendor/:file`，但
`webServer.register` 对重复 `(kind, path)` **直接抛错**，而 `dsh-contract-butler`
（`src/index.ts`）已经占了它。我再注册会让**对方的插件起不来**。
所以挂在 `GET /agent-world/vendor/:file`。理由写在 `src/vendor/README.md` 里。

**2. `web/scene3d.js`——3D 视图的第一帧**

等距正交相机（主题给 yaw/pitch/zoom）+ 半球/平行/环境光 + 阴影 + 雾 + ACES 色调映射 +
地块/站点/角色 + OrbitControls。**输入只有 `ScenePlan` + 实时 `world`**——
所以这个文件里**没有任何内容库知识**（没有颜色字面量、没有资产名）。
这正是决策 D23 那层缝的用处：换渲染器不用动模拟层与内容库。

同时 `M4-2/3/4/5/6` 一起满足了：相机、光照/雾、主题、皮肤、地块/站点**全都从内容读**。

**3. 视图切换**：`俯视`（2D，永久保留，决策 D21）/ `3D`。3D 用**动态 `import()`**：
three 加载失败（文件缺失 / 不支持 import map / 没有 WebGL）时退化成"3D 不可用 + 一句原因"，
**不会把整个面板带崩**——包括那个"唯一能看清模拟对不对"的俯视图。

**4. 计划外的修复：静态面板原来服务不了嵌套目录**

把 three 放进子目录时才发现：面板的静态路由是 `/:file`，**只匹配单段路径**。
也就是说 R8 写的静态服务**一直不能服务嵌套资源**，只是那时所有面板资源都是平铺的，所以没暴露。
给路由器加了末尾 `*`（匹配剩余全部段），并修了随之而来的一个**可用性倒退**：

新增 `/api/*` 兜底路由。因为通配会**接走任何路径**，于是 `/api/wrld` 这种打错的端点
原本会得到"不服务的文件类型"——那句话对排查毫无帮助（用户明明在调 API）。
现在给的是**已注册的 API 列表**。顺序就是优先级：`api → api/* 兜底 → vendor → 静态面板`。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 260 / pass 260 / fail 0
```

248 → **260**（router 通配 1 条 + 嵌套静态服务 1 条 + `test/vendor.test.js` 9 条 + 边界覆盖忽略清单 1 条）。

**浏览器实测**（不是"应该能跑"）：

| 检查 | 结果 |
|---|---|
| import map 解析 | `import('three')` → **418 个导出**；`import('three/addons/OrbitControls.js')` → `function` |
| 3D 真的画出来了 | `toDataURL` 198KB；160×100 缩样里 **788 种颜色**、**20.7% 非黑像素** |
| 没有静默失败 | `#view-hint` 为空且隐藏（3D 的错都会显示在这里） |
| 视图切换 | 3D → 俯视 来回切，俯视图花名册 8 行 / 工单 10 行都正常 |
| 白名单 | `vendor/README.md` → 404 且**列出已开放的文件**；`vendor/three.module.min.js` → 200 |
| 路径穿越 | `vendor/..%2fpackage.json` → 404 |

为了能程序化取像素，3D 渲染器开了 `preserveDrawingBuffer`——WebGL 默认在合成后丢弃绘制缓冲，
于是 `toDataURL()` 与截图工具拿到的是**空白**。这个面板有一部分用途就是"被人看/被人验"，
所以付出这点显存换"随时能取到当前这一帧"。

### 两个坑（都是测试在提交前拦住的）

1. **我自己新建的 `src/vendor/` 目录没登记** —— 上一轮（R14）刚加的"每个 `src/` 一级目录都必须
   登记或写进忽略清单"的检查，**第一个抓到的就是我自己的新目录**。当时我在断言文案里写了
   "要么写进忽略清单"，但**没有真的实现那个清单**——这轮补上了。
2. **import map 的替换静默没生效**（我那处 python 补丁漏了 `assert`）。后果是 3D 已经白屏了，
   而 `test/vendor.test.js` 里"import map 指向的文件必须在白名单里"这条**在提交前抓住了它**。

### 下一轮从哪继续

**M4-7：程序化几何构建器注册表**。这是"换模型只改内容"从口号变成事实的地方，也是当前 3D 最假的地方——
站点是方块、角色是胶囊，几何形状**写死在 `scene3d.js` 里**，`SceneProp.modelId` 根本没人读。
具体：

1. 读 `models` 库的条目（`kind: 'procedural'` 已经有 `builder` 字段，`kind: 'glb'` 走 M1.6-7 校验过的 URL）；
2. 在 `src/content/` 或 `src/scene/` 里建**构建器注册表**：`builder` 名 → 几何构造函数；
3. `ScenePlan` 里把 `modelId` 传下去，`scene3d.js` **按 id 查形状**，代码里不再有"方块/胶囊"的判断；
4. 未注册的 builder 要**报错并列出已注册的名字**（别静默退回方块）。

再之后就是 **M5（GLB + 骨骼动画 + 32 条剪辑）**，那需要联网拿 `pack.kenney-mini`。

### 假设

- **路 B 可逆**：vendoring 只动 `src/vendor/` 三个文件 + 一份 README，没有一行场景代码绑定版本。
  换版本的成本是"覆盖文件 + 更新 sha256 + 跑一遍测试"。
- **没有 bloom 是可接受的**：主题侧开关已预留。3D 的"好不好看"目前不是瓶颈，"世界在跑"才是。
- **`preserveDrawingBuffer` 值得**：代价是一块显存，换来"随时能取当前帧"——包括自动化核验。
- **根 `/vendor` 不该被本插件占用**：见上面那条偏离。如果将来宿主支持多所有者，应当回来对齐。

### 卡住 / 风险

- **网络第九次确认全断**。M5（GLB 骨骼动画）与 ASSETS.md 里写的 three 0.186.1 都还需要它。
- **M4-7 是本项目"内容可替换"的最后一处假象**：现在换主题/皮肤/地块已经真的只改内容
  （3D 直接从 `ScenePlan` 读），但**换模型形状**还得改代码。在 M4-7 落地之前，
  不要把"换资产只改内容"当成已验证的事实。
- **`web/` 仍是手写 JS 没有类型**（R10/R13/R14 都记过），而这一轮它又多吃了 `ScenePlan` 的字段。
  **下一次再往 `web/` 加逻辑就该动手改成 TS**——否则字段名会有第二份手抄件。
- **`decideOnBatch` 与 SSE 断线重连仍只有单测**（R13 记过）。
- **只看过一块屏幕**：3D 在 2112×1403 的高分屏上验过，没验窗口很窄时正交视锥与侧栏的挤压。

### 本轮产出

- 新增：`web/scene3d.js`、`src/vendor/{three.module.min.js, three.OrbitControls.js, LICENSE.three, README.md}`、
  `src/routes/vendor.ts`、`test/vendor.test.js`
- 修改：`src/routes/router.ts`（末尾 `*`）、`src/routes/index.ts`（`/api/*` 兜底 + 挂 vendor + `vendorRoot`）、
  `src/routes/panel.ts`（`/:file` → `/*`）、`scripts/copy-web.mjs`（同步 `src/vendor` → `lib/vendor`）、
  `web/app.js`（视图切换 + 动态导入 + `render` 分流）、`web/index.html`（import map + 3D 画布 + 切换按钮）、
  `web/style.css`、`test/{http,boundaries}.test.js`
- 文档：`ARCHITECTURE.md`（决策 D29/D30）、`BACKLOG.md`（M4-1/1b/2/3/4/5/6/8 done、M4-7 转 ready）
- 测试从 248 → 260

---

## R14 — 2026-10-15 · 资产路径安全边界（M1.6-7）+ 边界检查器的两个盲区（M1.6-8/9）

网络第八次确认仍断。取 M1.6-7——**M4 真正加载 GLB 之前必须落地**的那条。

### M1.6-7：内容包能把宿主变成任意 URL 的下载器

`models[].source.url` 与 `sounds[].url` 是**用户可写的字符串**，在真正去加载它之前可以是任何东西。

**洞是怎么来的**：它走的是 `checkId()`——而 `checkId` 的语义只是"非空字符串"，
那是为 **id** 写的最小检查。名字看着对（都叫"校验一个字段"），**保护却是零**。
于是 `http://evil.example/x.glb`、`data:...`、`../../../../etc/passwd` 全都能过。

新增 `src/content/asset-path.ts`，逐条拒绝：

| 拒绝 | 为什么 |
|---|---|
| URL 协议（`http:`/`https:`/`data:`/`file:`，以及 `C:` 盘符） | 内容包只能引用**包内**资产，不能把宿主变成下载器 |
| 绝对路径（`/` 开头） | 同上 |
| `~` | 依赖运行环境的家目录，换台机器就指向别处 |
| 反斜杠 | Windows 与 POSIX 解释不同，同一个包在两个平台读到**不同的文件** |
| `..` 上跳 | "包内相对路径"这个假象下最危险的一种 |
| 空路径段、无扩展名 | 前者是笔误，后者几乎肯定不是文件 |

报错给的是**允许的形状 + 一个例子**（`assets/characters/robot.glb`）。
教训写进决策 D28：**最小检查不能跨语义复用**。

### M1.6-8 / M1.6-9：检查器自己的两个盲区

**M1.6-8（反向盲区）**：加了"`src/` 下每个一级目录都必须在规则表里登记"的检查。
没登记的目录会被 `checkSource()` **静默跳过**——新建目录忘了登记，那个目录下所有跨模块
import 都不再被检查，而报告全绿。

**而这条新检查立刻抓到了东西**：规则表里有三个"幽灵模块"，其中 **`panel` 是过期条目**
（面板早并进 `routes/panel.ts` 了，规则还留着，app 的 `mayImport` 里也还列着它）。已删除；
计划中的 `bridge` 与不在 `src/` 下的 `web` 写进测试里**带理由**的 `planned` 表——
允许，但不能默默放过。记为 M1.6-10。

**M1.6-9（import 位置）**：R11 我写过两条 `import type` 落在接口声明之间，检查器把
`import type { World } from '../../domain/types.js'` 报成了 **`value-import`**。
当时我记的是"它对非顶部 import 不可靠"，这轮查下去发现**根因更严重**：

```
/(^|\n)[ \t]*(import|export)\b([^;]{0,400}?)from[ \t]*['"]([^'"]+)['"]/g
```

`[^;]{0,400}?` 遇到**没有分号的声明**（`export interface X { … }`）会一路吃过去，
把后面那条 import 的 `from` 当成自己的——于是语句被认成 `export`，`type` 不在开头，
分类成**值导入**。**反向的误判更危险**：真的值导入会被当成类型导入而**放过**——
一个会漏报的检查器比没有检查器更糟，因为它给人虚假的安全感。

已改成**逐语句扫描**（只在一条语句自己的范围内找 `from`，遇到新语句起点就停手）。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 248 / pass 248 / fail 0
```

231 → **248**（`test/asset-path.test.js` 15 条 + 边界检查器 5 条）。

有一条值得单说：**"修复本身也要被验证"**。提取器改对之后，真实源码（我已经把 import
挪回顶部了）无论修没修都是绿的——所以我补了**合成输入**的回归测试，直接喂那个曾经出错的形状，
并且**正反两个方向都测**（声明后面跟 `import type` 要认成类型导入；跟真值导入要被认成值导入）。
不然这次修复就是**没有证据的**。

### 下一轮从哪继续

**不受网络影响的活基本到此为止了。** 剩下的 `ready`：

1. **M3-1b**（`events.jsonl` 无上限增长）：我明确写过"**错误的分片比不分片更难改**"，
   倾向等有真实长跑数据再定。**不主动做。**
2. **M2.6-1**（消息文案要不要进内容库）：**需要用户拍板**的取舍。
3. **M1.6-7b**（`ActionEntry.clip` 校验）：**依赖 M4**（剪辑名在 GLB 内部，加载后才知道）。

所以下一轮要么等用户对 M4 路线拍板（路 A 修网络 / 路 B vendoring `three@0.167.1`），
要么只剩 M3-1b——而那是**在错误的时机做一件改了更难改的事**，我不会主动选它。

**如果到点还是没有任何选择，我会停下并明确报告"没有可做的活了"**，而不是为了产出而产出。

### 假设

- **`ActionEntry.clip` 不在这条范围里**：它是**剪辑名**不是路径，没法静态校验（剪辑在 GLB 内部）。
  已记成 M1.6-7b，等 M4 加载器落地时查，且报错要**列出该模型实际有的剪辑名**。
- **`contentDir`（宿主配置）不适用这套规则**：那是宿主管理员给的路径，信任级别不同。
  内容 JSON 是"别人写的包"，两者不该共用一条边界。
- **`planned` 表可以存在，但必须带理由**：一概禁止会逼着人删掉还没建目录的契约规则；
  一概放过则会掩盖像 `panel` 那样的过期条目。

### 卡住 / 风险

- **网络第八次确认全断**，M4 只能等用户拍板。
- **`events.jsonl` 只增不减**（M3-1b）——唯一还能做的离线活，但它属于"时机不对"的那类。
- **`decideOnBatch` 与 SSE 断线重连仍只有单测**（R13 记过）：真验需要切断网络或 kill 服务端。
- **`web/` 仍是手写 JS 没有类型**（R10/R13 都记过）。这一轮没有加剧它，但它还在。

### 本轮产出

- 新增：`src/content/asset-path.ts`、`test/asset-path.test.js`
- 修改：`src/content/validate.ts`（`models`/`sounds` 改走路径校验）、
  `src/protocol/boundaries.ts`（删掉过期的 `panel` 模块规则）、
  `test/boundaries.test.js`（提取器改为逐语句扫描 + 目录覆盖检查 + 5 条回归测试）
- 文档：`ARCHITECTURE.md`（决策 D28）、`BACKLOG.md`（M1.6-7/8/9 done、M1.6-7b/10 新增）
- 测试从 231 → 248

---

## R13 — 2026-10-15 · 面板换成 SSE 增量（M3-6）：删掉轮询

网络第七次确认仍断。做 R12 留下的 M3-6。

### 动手前先发现的一件事：增量载荷**不够**

面板要从"每 400ms 拉全量快照"改成"只收增量"，那就必须先回答：
**事件带的信息够不够重建画面？** 查了一遍——**不够**：

- 完工的 `task.changed` 不带 `progress`（工单板会永远显示上一次里程碑）；
- `agent.state` 事件不带"变更后"的 `station`/`carrying`——客户端不知道把人从工位上摘掉，
  画面上他会**永远坐在那张桌子上**；
- `agent_world_dispatch` 是**在 tick 之外**加派工单的，**根本不产生事件**，
  所以只收增量的客户端永远看不到新工单。

这三条的共同点很值得记：**它们的症状都只在换成增量之后才出现，而且看起来像"渲染层没刷新"**
（全量快照是对的，所以对比着看会觉得是显示问题）。所以这一轮必须先修协议，再改面板。

修法两处：

1. **`src/sim/patches.ts`**：每条事件**并入变更后的当前值**（`agentPatch` / `taskPatch`），
   而不是在每个调用点手写要带哪些字段——手写迟早漏一个，漏的症状如上。
   判据写进了文件头：**面板从快照里读的字段，增量里也必须能拿到**。
2. **运行时按 seq 水位线发布**，而不是发布 `result.events`。
   这样"只要进了日志就会被推出去"，无论它来自哪一步——tick 之外产生的变更（派单）因此也能到客户端。
   配套加了 `noteTasksAdded()`（`sim/journal.ts`），让 `state.dispatch` 进日志。

### 做了什么

**`web/world-update.js`（新）** —— 增量应用，**纯函数、不碰 DOM**。单独一个文件不是为了好看，
是为了**能被 node 测**：改成增量之后，"事件够不够重建画面"没有任何肉眼可查的手段。

**`web/app.js`（重写）** —— 启动拉一次快照，之后只吃 `EventSource`。**轮询分支已删**。

**`src/routes/events.ts`** —— 心跳从纯注释改成 `sync` 帧（带当前 tick/seq/paused）。
理由在下面「假设」一节，那是一条实测出来的事实。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 231 / pass 231 / fail 0
```

218 → **231**。核心是一条**往返比对**：

> 从 tick 0 的快照出发 → 把这 N 步产生的**全部事件**应用到本地副本 → 与**真实世界逐字段比对**。

少一个字段就红，而且会指出是哪个字段。另外配了一条**反例测试**（故意删掉 `agent.state` 里的 `station`
键），证明这条往返比对**抓得住**——不然它就是一条永远绿的摆设。

**两类量刻意不放进比对**，因为它们的设计就是"采样下发"（决策 D27）：

- **精确 `progress`**：进度只在里程碑发（每 tick 推 24 条是纯浪费），客户端插值。
  第一版我比了精确值，红了 —— **红得对，是我的断言错了**。
- **`tick`**：没有变更的那些步不产生任何事件，所以客户端只能靠 `sync` 心跳校准 + 本地时钟推进。
  实测里客户端会**落后 32%**（810 vs 1200），UI 上就是"世界明明在跑，时间却不动"。

**浏览器实测**（真链路，不是单测）：面板启动后**只发出 1 次快照请求**（`performance.getEntriesByType('resource')` 里数出来的），
之后 `seq` 持续增长（`1026 → 1068`）；点"暂停"→ 命令走 POST → **状态经事件流回来**（`已暂停`，且 tick 冻住）；
点"继续"→ 恢复。全程没有一次轮询。

### 踩到的两个坑（都值得单独记）

1. **`requestAnimationFrame` 在不可见的标签页里不触发**。第一版用 rAF 做渲染节流，
   于是页面在后台时状态栏一直停在 `连接中…`（DOM 与画布都是初始状态），
   而同一时刻手动 `fetch` 与 `EventSource` **完全正常**。这个组合极难判断——
   看起来像"面板坏了"，实际是"没人看它，所以它不画"。
   而这个面板的典型场景恰恰是"agent 在跑、人不一定在看"。已改成时间戳节流。
   **记成 M3-6b 并写明**：将来 3D 的主循环若用 rAF，要显式决定"后台渲染不渲染"，
   别让它变成"分不清是设计还是 bug"。
2. **gap 判定漏了"倒退"**。我原来只判 `first.seq > lastSeq + 1`（中间缺了一段）。
   但**重开一局**之后 seq 从头开始，这个条件不成立，于是新世界的事件会被叠到旧世界上——
   而画面上只是一堆对不上的状态，**不会报任何错**。当场修了：抽成纯函数
   `decideOnBatch()`（三种情况都有测试），倒退与重放一律重拉快照。

### 下一轮从哪继续

**M1.6-7：JSON 里的路径安全边界**（`ModelEntry.source.url` 限制成包内相对路径，禁 `http://` 与 `../`）。
**M4 真正加载 GLB 之前必须落地**，而且无论走"路 A 搜现成场景"还是"路 B vendoring three"都会读模型 URL。
具体：`src/content/validate.ts` 的路径校验 + 测试；报错要指出**允许什么形状**（包内相对路径），
不是只说"无效"。

再之后**不受网络影响的活基本就没了**（M2.6 那几条要么依赖 M5、要么是要用户拍板的文案取舍）。
**所以 M4 的路线选择越来越成为唯一的阻塞**。

### 假设

- **心跳改成 `sync` 帧而不是纯注释**：注释行能保活但**不携带信息**，而客户端在
  "世界静止时没有任何变更事件"的情况下需要权威时间。选择"心跳带时间"而不是
  "每 tick 都发帧事件"，是因为后者把事件量从 0.33/步 抬到 1/步——一天多几十 MB 日志，
  而收益只是让客户端省掉一个本地时钟。
- **本地时钟是必要的**，不是过度设计。客户端在两个 `sync` 之间用 `tickMs` 自己走；
  这是标准做法（服务端时间 + 客户端插值），而不是"客户端猜服务端"。
- **`sync` 帧不 +1**：它报的是"世界已经走到哪"，不是"某一步之内"。第一版没区分，
  时钟每次校准都多跑一步。
- **`decideOnBatch` 对"完全相同的重放"也重拉快照**，不做"跳过重复的"优化——
  重开一局时那些 seq 看起来重复但属于另一个世界，省这一次快照换来一个静默的错值不值。

### 卡住 / 风险

- **网络第七次确认全断**。M4 只能等用户拍板（路 A 修网络 / 路 B vendoring `three@0.167.1`）。
- **`events.jsonl` 只增不减**（M3-1b）现在**计息更快了**：面板改成 SSE 之后世界会长时间开着跑，
  一天约几万行。仍不是问题，但仍是那种"等到是问题就来不及优雅解决"的东西。
- **面板的 gap 自愈只有单测，没有"真的断线再重连"的端到端验证**。
  要真验得用 CDP 把网络切断再恢复，或者手动 kill 服务端。已记在心里，不算已验。
- **`web/` 仍是手写 JS 没有类型**：现在它吃 `ScenePlan` + 事件载荷两类形状，
  而这两类形状是**手抄**的（`world-update.js` 里的字段名 vs `patches.ts` 里的）。
  R10 就记过这条，R13 又加了一层。**再加就该动手改成 TS + 构建**——否则它们迟早对不上，
  而对不上的表现正是这一轮花大力气修的"少一个字段"。

### 本轮产出

- 新增：`web/world-update.js`、`src/sim/patches.ts`、`test/world-update.test.js`
- 修改：`src/sim/{emit,journal}.ts`（载荷带齐 + `noteTasksAdded`）、`src/runtime/index.ts`
  （按 seq 水位线发布）、`src/state.ts`（派单进日志）、`src/routes/events.ts`（`sync` 心跳）、
  `web/app.js`（重写：SSE + 时间戳节流 + `decideOnBatch`）
- 文档：`ARCHITECTURE.md`（决策 D27）、`BACKLOG.md`（M3-6/M3-7 done、M3-6b 新增）
- 测试从 218 → 231

---

## R12 — 2026-10-15 · SSE 事件流（M3-4，服务端）

网络第六次确认仍断（`api.github.com` 仍是 `000`）。继续做不受网络影响的活，取 M3-4。

**本轮只做服务端**：面板从轮询改成 `EventSource` 是 M3-6，留给下一轮。
一次别贪——SSE 的服务端有三处容易错的地方（续传、泄漏、背压），值得单独一轮做透。

### 做了什么

**`src/runtime/hub.ts`** —— 事件广播。它同时是出口（模拟内核往里丢）与入口（订阅者从它取）。

关键约束：**`publish` 是同步的，而且它跑在模拟循环里**。所以：

- 每个订阅者单独 try/catch——一个坏订阅者不能让别人收不到事件，更不能把模拟循环带崩；
  但**刻意不假装没发生**：`listenerErrors` 计数留着。
- 遍历前把订阅者**快照成数组**：订阅者可能在回调里取消订阅（连接刚好断开），
  直接遍历 `Set` 会在迭代中途改变集合——那是最难复现的一类 bug。有测试专门打这条。

**`src/routes/events.ts`** —— `GET /api/events`。三件必须自己做的事：

1. **`id:` 带 `seq`**。浏览器断线重连会自动带 `Last-Event-ID`，服务端据此补发——
   这就是"gap 自愈"的服务端一半（客户端那一半 `hasSeqGap` 早就写好并有测试）。
   **补得了就补，补不了就明说**：客户端给的 seq 已经滚出环形缓冲时，发一条 `reset`
   让它重新拉快照。假装能补的后果是客户端**静默**丢一段历史。
2. **慢客户端断开，不缓冲**。`res.write` 返回 false 说明内核缓冲满了，继续写就是让内存
   随一个卡住的浏览器无限增长。断开更好——重连会带来一次续传。
   这也正是广播层的 `publish` 能保持同步的前提。
3. **心跳注释**。世界暂停时没有事件，长连接会被中间层掐掉，所以定期发 `: ping`。

**清理是硬要求**：`req`/`res` 的 `close`/`error` 都挂 `finish`，摘订阅 + 清心跳。
不摘的话热重载会泄漏订阅者，症状是"每改一次代码，模拟循环要推的客户端多一个"——
和 R7 那个定时器泄漏同类。有测试断言**断开后 `subscriberCount` 回到 0**。

**装配**：`index.ts` 建一个 hub，同一个对象既当运行时的 `sink` 又当路由的 `source`。
路由表顺序也调了：SSE 与 API 在前、静态面板兜后——不然 `/api/events` 会被 `/:file` 先吞掉。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 218 / pass 218 / fail 0
```

205 → **218**（新增 `test/sse.test.js`）。除了单测，还**用真实 HTTP 服务器 + curl 走了一遍真链路**：

```
: agent-world v1                                    ← 握手注释
data: {"v":1,"type":"hello","seq":133}              ← 当前 seq
retry: 3000
id: 133
data: {"v":1,"type":"events","events":[{"seq":133,...}]}
```

带 `Last-Event-ID: 2` 再连一次，服务端**真的补发了 seq 3 起的全部事件**——
续传不是"写了没验"的代码。

测试盯的三处（都是这一层真正容易错的地方）：

- **续传三态**：还在缓冲里 → 补得正好（多补会重复应用、少补会静默丢历史）；
  太旧 → `reset` 且**不假装补得齐**；比服务端还新 → 什么都不补也不报错。
- **泄漏**：连接断开后订阅数回到 0（两条测试，一条专测）。
- **背压**：`res.write` 返回 false 之后必须摘订阅、说明原因、`end()`。

**三处是我自己写错、被测试逼回来的**（值得记，因为都发生在测试侧）：

1. 解析 SSE 帧时只认注释与 `data:`，于是 `retry: 3000` 被解析成一个空帧混进 `frames[0]`，
   让几条断言对着错的东西发火。教训：**测试也要按帧类型挑，不能数帧数**。
2. 断言"连接关掉之后订阅必须摘干净"时没有等服务端处理断开（那是异步的）——
   测试太急，不是实现没摘。改成轮询到期限内。
3. 用中文当 `Last-Event-ID` 的值，被 undici 直接拒掉（HTTP header 只允许 ISO-8859-1）。
   红在 `fetch` 而不是在实现上。

### 下一轮从哪继续

**M3-6：把面板从轮询改成 `EventSource`**（服务端已经就绪）。具体：

1. `web/app.js` 的 `poll()` 拆成两半：**初始拉一次快照**（`GET /api/world`），
   之后只靠 `EventSource('/agent-world/api/events')` 推增量。
2. 增量要**真的应用**到本地世界：`world.tick`（位置，元组数组 `[id,x,z,facing]`）、
   `agent.state`、`task.changed`、`message.sent`。载荷形状见 `docs/PROTOCOL.md` §4.4。
3. **gap 自愈的客户端一半**：收到 `reset`、或者 `EventSource` 重连成功时，
   重新拉一次快照（`hasSeqGap` 可用来判断本地的累积是否还连续）。
4. 保留 R10 加的 **fetch 超时**与**"数据已过期 N 秒"**提示——换成 SSE 之后
   "多久没收到事件"仍然要显示，只是判据从"多久没拉到快照"变成"多久没收到心跳/事件"。
5. 轮询分支要**删掉**，不要留着当后备——两条路都活着就会有两个真相。

再之后：**M1.6-7**（JSON 路径安全，M4 加载 GLB 之前必须落地）。

### 假设

- **`hasSeqGap` 的语义是"只判倒退与完全相同"**（跨度过大不算断裂）。所以服务端补发时
  只要发出的 seq 单调递增，客户端就不会误判。这条假设写在 `protocol/wire/messages.ts`
  的注释里，本轮没有改它。
- **心跳 15 秒**是经验值：比大多数反代的空闲超时短，又不至于占带宽。
  已经做成可配（`eventsRoutes({ heartbeatMs })`），测试用 40ms。
- **`retry: 3000`** 由服务端给：重连间隔属于服务端的部署属性，不该由浏览器默认值决定。

### 卡住 / 风险

- **网络第六次确认全断**。M4 依然只能等用户拍板（路 A 修网络 / 路 B vendoring `three@0.167.1`）。
  剩余不受网络影响的活：M3-6（面板换 SSE）→ M1.6-7 → M2.6 系列。**做完这些，除 M4 之外
  就没有可做的了**。
- **真实 socket 上的背压路径没有端到端测试**（M3-4b）。慢客户端分支是用假 res 打进分支的——
  逻辑验到了，但"真的把 socket 灌满之后 `write` 确实返回 false"这条没验。
  已明确记着，**不当作已验**。
- **面板此刻同时有两条可能的路**：轮询（现在在用）与 SSE（已就绪但没人连）。
  在 M3-6 落地之前，`/api/events` 是"建好但没人用"的状态——这正是我在 M2.5-2 批评过的形态，
  所以它**必须**在下一轮接上，不能停在这里。

### 本轮产出

- 新增：`src/runtime/hub.ts`、`src/routes/events.ts`、`test/sse.test.js`
- 修改：`src/routes/index.ts`（挂 SSE + 路由顺序 + `heartbeatMs`）、`src/runtime/index.ts`（转出 hub）、
  `src/index.ts`（装配 hub，同一个对象两副面孔）、`test/http.test.js`（补 `source`）
- 文档：`ARCHITECTURE.md`（决策 D26）、`BACKLOG.md`（M3-4 done、M3-4b 新增、M3-6 更新）
- 测试从 205 → 218

---

## R11 — 2026-10-15 · 落盘（M3-1）：世界不再一重启就归零

网络第五次确认仍断（`api.github.com` / `registry.npmjs.org` 都是 `000`），所以继续做
不受网络影响的活。取 BACKLOG 最上面的 `ready`：**M3-1 磁盘真相**。

### 做了什么

**`src/store/worldStore.ts`** —— 两个文件，两种语义，**刻意不合并**：

| 文件 | 语义 | 写法 |
|---|---|---|
| `world.json` | 整世界的快照（"现在是怎样"） | 原子覆盖：写 `world.json.tmp-<pid>` → `fsync` → `rename` |
| `events.jsonl` | 只增的事件历史（"怎么变成这样的"） | 追加，一行一条、换行结尾 |

四条决定，每条都有具体理由：

1. **快照里不带 `world.events`**。那是**环形缓冲**（只留 500 条），是活客户端的补洞窗口、
   不是历史。把它当历史写进快照，历史会在第 501 条事件时开始**静默**丢失——
   而"历史丢了一段"只在需要它的时候才会发现。
2. **原子写的顺序不能省 fsync**。不 sync 的话 `rename` 可能先于数据落盘完成，
   掉电后得到"名字对、内容空"的文件——**那比没有存档更糟**。
3. **文件里不写墙上时间**，只用 `tick`。于是"同一个世界存两次得到逐字节相同的文件"
   可以被直接断言（有测试）。这让"存档可复现"变成可验的，而不是靠肉眼比。
4. **内容包版本放在外壳里**（`content: [{id, version}]`），不塞进 `World`。
   `World` 是模拟内核的模型，不该知道"装了什么版本的内容"这种装配层事实。

**接进运行时（这部分才是"做完"）**：`PersistOptions` 让运行时每 `checkpointEveryTicks`
存一次快照并**攒着**刷一次事件。三条细节：

- 事件是**攒着一起写**的：每 tick 一次 append 就是每秒 10 次磁盘写入，而它们加起来还没
  一次快照大。代价是崩溃时最多丢这么多 tick 的事件——而快照也是同一粒度，
  **两者对得上**，不会出现"世界是第 700 tick、事件只到 650"这种自相矛盾的存档。
- **先写事件、后写快照**。反过来的话快照会声称"世界到了 700"而日志才到 650；
  先写事件，最坏是"事件多了几条、快照旧一点"——那是**可解释**的。
- 写失败时把那一批事件**放回队列**等下次重试，并累加 `diagnostics.persistErrors`
  （这个计数会经 HTTP 快照到面板，非 0 时状态条直接报警——避免又造一个"建好没人读"的计数）。

**恢复（这才是 M3-1 的意义）**：`createPluginState(...).ensureWorld()` 现在**先试着把上次
的世界接回来**，接不回来才新开一局。三道关：

1. 文件能不能读、格式对不对（`fileVersion` 不匹配就拒绝，并说清期望哪个版本）；
2. **场景还在不在**当前内容里——不在就**拒绝采用**，宁可新开一局也不要一个渲染不出场景的世界；
3. 内容包版本变没变——**变了照常采纳**，但写一条 ——内容升级本来就该改变表现，
   这正是"内容可替换"的意义；但"旧存档为什么变样了"必须能查，不能靠猜。

**恢复绝不能是静默的**：成功时 `restoredFrom()` 会把它说出来，`agent_world_status`
直接打一行"⚠ 这一局是从存档接回的：存档停在 tick N，当时用的内容包是 …"。
否则症状是"我明明重开了，怎么还是上次的样子"。

**关停路径用同步刷盘**：`stop()` 之后进程可能立刻退出，`await` 出去的写不保证跑得完——
那正是"最后一段历史丢了"的成因。所以加了 `saveWorldSync` / `appendEventsSync`
（`fd + fsyncSync + renameSync`），`stop()` 走同步路径。有一条测试**在 stop 之后不 await、
不等事件循环**直接同步读档，断言文件已经完整。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 205 / pass 205 / fail 0
```

182 → **205**（新增 `test/store.test.js` 23 条）。测试集中在这一层真正的风险上——
**不是"算错"，而是在错误的时候毁掉数据**：

- **逐字节可复现**：同一世界存两次文件完全相同。
- **原子性**：写完不留 `.tmp-*`；`info().strayTempFiles` 为空。
- **坏存档不让插件起不来**：半截 JSON → `warning` + 新开一局（**不抛**）；
  `fileVersion` 不匹配 → 拒绝并说出期望版本；`world` 缺字段 → **报出缺的是哪个、
  并列出实际有的字段**（"存档损坏"四个字帮不了任何人）。
- **长跑端到端**：跑 400 tick → 落盘 → **新起一个插件状态** → tick 是 400、工单还在、
  `restoredFrom()` 有值 → **接着跑还能跑**（不是一份只读快照）。
- **写失败不丢历史**：注入一个会抛的 store，断言 `persistErrors` +1 且**那一批事件
  在修好之后被重试写下去**。

### 顺手处理的两件真事

1. **测试开始往包目录里写存档**。`persistEveryTicks` 默认 100，而 `stateDir`
   按 `process.cwd()` 解析——测试的 cwd 就是包目录，于是第一次跑完就在仓库里留下了
   `packages/dsh-agent-world/.agent-world/world.json`，**第二次跑就"恢复"了上一轮的世界**，
   表现为"世界应当用外部花名册"那条测试拿到的是内置花名册。
   修法不是关掉落盘，而是**让测试变干净**：所有 `apply(...)` 显式传 `persistEveryTicks: 0`，
   落盘相关的测试一律用临时目录。另加一个**包级 `.gitignore`**（`/.agent-world/`、`/lib/`）
   作为兜底——存档是运行时数据，不该进版本库。
2. **边界检查器的一个新盲区**：我把两条 `import type` 写在了接口声明**之间**
   （合法 ESM，因为 import 会提升），检查器把 `import type { World } from '../../domain/types.js'`
   报成了 **`value-import`**。也就是说它对"非顶部 import"的分类不可靠。
   已记成 M1.6-9（原来只有 M1.6-8 那条"目录不在规则表里就被跳过"的盲区）。

### 下一轮从哪继续

**M3-4：SSE（`GET /api/events`，带单调 `seq`，客户端 gap 自愈）**，然后把面板从轮询
改成 `EventSource`（M3-6）。具体：

1. 新建 `src/routes/events.ts`：`RouteEntry`，`handler` 返回 `undefined` 并自己接管响应
   （`router.ts` 已经支持这条路径——静态面板就是这么做的）。
2. **必须挂清理**：连接断开时要摘掉订阅（`res.on('close', ...)`），否则热重载会泄漏监听器
   ——和 R7 那个 `setInterval` 泄漏是同一类问题。
3. 事件来源用现成的 `EventSinkPort`（`createRuntime` 的 `sink` 选项已经预留，默认 `nullEventSink`）。
   需要一个多播适配器：运行时推一批 → 广播给所有活跃连接。
4. **gap 自愈**：`protocol/wire/messages.ts` 的 `hasSeqGap` 已经写好并有测试，
   接上即可——断线重连后客户端发现 `seq` 不连续就重新拉一次快照。
5. 落盘那条线**已经不用再管**：`events.jsonl` 与 SSE 各写各的，互不依赖。

**两条欠账仍然挂着**（都不是本轮该顺手做的）：
`events.jsonl` 无上限增长（M3-1b，需要分片策略，**错误的分片比不分片更难改**）；
`stateDir` 的相对基准（M3-1d，与 M1.5-6 同源）。

### 假设

- **默认落盘（`persistEveryTicks: 100`）是值得的**，尽管 `stateDir` 目前只能按 cwd 解析。
  理由是"重启不丢世界"是这个插件的基本预期，而写盘位置已经被日志大声打出来了。
  如果用户认为默认往 cwd 写文件太激进，把它改成 0 即可（一行配置）。
- **恢复时保留存档里的 `paused`**。用户上次暂停了，这次接回来就是暂停的——
  面板会显示"已暂停"，点一下继续即可。刻意不擅自改成运行中：那才是真正的"静默改变用户状态"。
- **`fileVersion` 不匹配一律拒绝，不做迁移**。现在只有版本 1，写迁移代码是凭空造需求；
  等真有旧存档要救的时候再按实际形状写。

### 卡住 / 风险

- **网络第五次确认全断**。M4（3D）依然只能走"路 A 等网络"或"路 B vendoring `three@0.167.1`"，
  而两者都需要用户拍一下板。**在等这个决定的同时，不受网络影响的活已经不多了**：
  M3-4 SSE → M1.6-7 JSON 路径安全 → M2.6 系列。做完这些，M4 就是唯一的下一步。
- **`events.jsonl` 只增不减**：现在有了真实的长跑场景（世界会一直跑），这个账**开始计息**了。
  一整天约几万行。还不是问题，但它是那种"等到是问题就来不及优雅解决"的东西——
  已记 M3-1b 并写明"倾向：等有真实长跑数据再定"。
- **同步与异步两套写接口**是刻意的冗余（关停路径必须同步），代价是两处实现要一起改。
  解析与外壳构造已经抽成纯函数共用，但"写"本身仍是两份——加新文件时**两处都要改**，
  这是我在实现里留的风险。

### 本轮产出

- 新增：`src/store/{worldStore,index}.ts`（快照 + 事件历史 + 原子/同步写 + 读档校验）、
  `test/store.test.js`（23 条）、`packages/dsh-agent-world/.gitignore`
- 修改：`src/runtime/index.ts`（checkpoint / 事件缓冲 / `flush` / `flushSync` / `persistErrors`）、
  `src/state.ts`（恢复 + 三道关 + 原因写进 issues）、`src/index.ts`（装配 store + 日志）、
  `src/config.ts`（`persistEveryTicks`）、`src/protocol/{ports/{runtime,world-service},index}.ts`
  （`PackVersion` / `RestoredFrom` / `persistErrors`）、`src/tools/world.ts`（状态里打出恢复来源）、
  `web/app.js`（落盘失败报警）、`test/{smoke,external-pack,dispatch-runtime,http}.test.js`（测试变干净）
- 文档：`ARCHITECTURE.md`（决策 D25）、`BACKLOG.md`（M3-1 含 1b/1c/1d、M1.6-9）
- 测试从 182 → 205

---

## R10.5 — 2026-10-15 · 参考实现地图（用户要"搜 GitHub 借鉴"，但网络不通）

**请求**：用户澄清「我就是希望你能搜索到 github 拿到一些参考项目，借鉴比较难实现的东西」。

**结论：搜不了。** 第四次重测，`api.github.com` / `raw.githubusercontent.com` /
`registry.npmjs.org` **全部 `000`**；`web_search` 工具仍是 401（端点是用户在设置里配的，
不该我改）。所以本轮**没有、也不可能**产出 GitHub 参考。

**但没空手**：用户要的是「参考项目 + 借鉴难实现的东西」，而**本机就有**——
而且比随手找的仓库更对口，因为它们是**同一批库**在真实项目里的用法（有类型、有测试）。

产出 [`docs/REFERENCES.md`](REFERENCES.md)：

- **可借鉴的本机项目**：`msim-front-react/src/pages/MvizLite/viz3d/`（~40 个源文件的
  分层 3D 可视化引擎，与我们"引擎 + `ScenePlan` + 图层"几乎同构）、
  `QuickVizPro/core/ThreeVizEngine.ts`（2386 行，天空/光照按录制时间驱动、双引擎共享相机）。
- **难点 → 具体文件**（每条都 grep 核实过关键 API，**没有逐行读完**，文档里标注了这一点）：
  - 等距↔透视切换 → `engine/CameraRig.ts`：同时持有两个相机、切模式要重建
    （`OrbitControls` 绑在相机实例上）、按 `instanceof` 分支取 `zoom`/`fov`。
  - 内容→样式收敛 → `layers/styleResolver.ts`：**与我们"token 在服务端解析完"是同一个套路**，
    等于验证了那层设计。
  - 大量实体 → `layers/builders/pointCloudBuilder.ts`：形状简单但数量多走 `InstancedMesh`。
  - 事件不打架 → `LiteLabelerController` 与 `MeasureController` 各给了一种解法
    （前者中/右键留给 OrbitControls，后者在 capture 阶段拦截）。
  - 一个必须非零的坑 → `SceneContext.ts`：矩阵缩放不能是严格 0，否则不可逆世界矩阵
    会让 `Mesh`/`InstancedMesh` 的 raycast 失效。
  - **3D 代码怎么测**（本包最需要的）→ `viz3d/test/` 下注入假 `OrbitControls`、
    用 `instanceof InstancedMesh` 断言几何与实例化——**渲染器不参与也能验**，
    正好支撑我们把 `ScenePlan` 做成纯函数。
- **诚实标出本地没有的三块**（三个前端项目里逐个 grep 过，**全是 0 个文件**）：
  骨骼动画（`AnimationMixer`/`SkeletonUtils`/`SkinnedMesh`）、SDF 文字（装了 `troika` 但零使用）、
  后处理（`EffectComposer` 零使用）。这三块才是真需要 GitHub 的，**已写明联网后搜什么、
  以及两条筛选标准**。
- **借鉴的边界**：那些项目是 React + R3F，我们按决策 D7 是纯 three.js——
  借算法与结构，不搬组件外壳。

顺手修掉一处**过期的 README**：它还写着"状态：R2"，而工具表只列了两个工具、
说"3D 场景还没接上，所以现在看不到小镇"。实际已有四个工具、世界会自己动、
而且**已经有一个能看的 HTTP 面板**。已更新，并明确写上
**插件尚未装进任何 profile、安装路径未验证**——避免 README 造成"已经能用了"的错觉。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 182 / pass 182 / fail 0
```

本轮**只动文档**（`docs/REFERENCES.md` 新增，`README.md` / `BACKLOG.md` / `PROGRESS.md` 更新），
**没有改一行代码**，所以测试数与上轮一致（182）。

### 下一轮从哪继续

不变：**路 A（联网后按两条硬标准搜现成场景）** 或 **路 B（用本机 `three@0.167.1` 走 vendoring 起 3D）**。
无论走哪条，**动手前先读 `docs/REFERENCES.md`**——M4 里除了骨骼动画/SDF 文字/后处理，
其余难点本机都有可借鉴的实现，不需要等网络。

不受网络影响的活（优先序同 R10）：M3-1 落盘 → M3-4 SSE → M1.6-7 JSON 路径安全。

### 假设

- **"搜 GitHub"的真实目的是"少走弯路"，而不是"必须来自 GitHub"**。
  所以我按这个目的交付：把本机已有的、且经过生产验证的同类实现整理成地图。
  如果用户**坚持**要 GitHub 上的具体项目，那只能先修网络。
- **本机那些项目是用户自己的代码**，借鉴不受许可证限制；将来从 GitHub 引入的才受
  MIT/Apache-2.0/CC0 那条约束。已写在文档里。

### 卡住 / 风险

- **仍然没有 GitHub 参考**。这是第四次确认网络不通，不是"再试一次"的问题。
- `REFERENCES.md` 里的判断**基于 grep 与结构清点，不是逐行阅读**。文档里逐条标了
  「已核实」与「仅清点」，用之前要按标注对待——不要把我"看过文件名"当成"读过实现"。

---

## R10 — 2026-10-15 · 把 R7 预览里看到的两处模拟缺口补掉（M2.5-1 / M2.5-2）

**先说网络**：用户选了「路 A」（联网搜现成场景），但我当场重测——**仍然全断**
（`api.github.com` / `registry.npmjs.org` / `example.com` 全是 `000`）。
所以路 A 现在还没法起步，这是环境问题不是选择问题。按纪律不停下来等，
本轮做的是**不受网络影响、也不需要谁拍板**的那两件：R7 从真实输出里发现的缺口。

### M2.5-1 · 空闲角色全叠在出生点

现象：8 个人里 6 个待命时，坐标**全是 (0,0)**。俯视图里只看得到一个字符
（其余被完全盖住），3D 场景里就是 6 个人穿在同一格。

根因不是"渲染错了"，是**设计没覆盖到这里**：角色只在被派活时才移动，
所以从没被派过活的人一步都不会走。

做法：给 `Agent` 加 `hangout`（歇脚点），新增 `src/sim/idle.ts` 的 `advanceIdle()`
让待命的角色朝它走、到了就停。落点用 `domain/geometry.ts` 新增的 `latticeIn()`
在**广场地块**里铺一层确定性栅格，由 `world/create.ts` 分配。

两个刻意的取舍：
- **不给新的 `AgentState`**。加一个状态就要连带加一条 `actions` 内容（校验器要求
  每个状态都有动作，否则角色会僵在上一帧），而这里要做的事很轻。
  代价说清楚了：`idle` 的语义变成"没活干（可能正在走去歇脚点）"。
- **用栅格不用随机**。模拟内核禁 `Math.random()`；而且随机点会让"同 seed 同结果"破掉——
  那条性质不该为了让人站得好看而牺牲。

### M2.5-2 · 邮箱建好了但没有任何发送方

现象：跑 700 步 `world.messages` 是 0 条。延迟投递、飞行中判定、纸条动画的数据源
R6 就建好并且有测试，**但模拟里没有任何一处会发消息**——一条从不被使用的链路
等于"设计上支持"，不是"能用"。

新增 `src/sim/comms.ts`，只发两处，都是真实的交接：

| 时机 | 消息 | 收件人 |
|---|---|---|
| 领到一张**有前置**的单 | `handoff` | 完成前置的那个人 |
| 某张单完工 | `report` | `lead` |

只加两处是为了守住事件量策略（消息是离散量）。顺手补了上界：
`MESSAGE_RING_SIZE = 200`，**只裁已送达的**（还在飞的纸条丢了就是渲染层凭空少一张纸）。
为此消息发号改用新的 `world.messageSeq` —— 原来用 `messages.length`，
一旦开始裁剪就会重复发号。

### 顺手修掉的两个真实缺陷（都是"改动之后才暴露"的）

1. **`message.sent` 发错了时机**。原先只在**送达**时 emit，于是渲染层要等 10 tick
   才知道有纸条要飞——那时它已经在两端了，"从 A 飞向 B"这段过程**根本没数据可画**。
   改成入队时发，并把 `deliverAtTick` 一起带上；送达因此不需要单独事件（时刻算得出来）。
   投递延迟通过 `RuntimePort.messageDeliveryTicks` 透给路由，渲染层不用自己抄常量。
2. **`runtime.diagnostics.ticks` 统计错了东西**。它数的是"循环转了几圈"，
   暂停时仍持续上涨，表现为「HUD 说跑了 600 步、可 tick 才 388」。
   改成只在 `world.tick` 真的前进时计数。

### 动手时踩到的三处，全部被自己的检查器/探针抓住

1. **反向依赖（又一次）**：`routes/api.ts` 为了拿 `MESSAGE_DELIVERY_TICKS` 去 import
   `domain/constants` → `[value-import] routes → domain`，边界检查器当场报错。
   修法不是放宽规则，而是把它挂到 `RuntimePort` 上——**运行时正是路由能看到模拟的唯一出口**。
2. **红线违规：代码里写字面色值**。我在 `app.js` 里写了
   `m.kind === 'handoff' ? '#F0B429' : '#7FD1E8'`——直接违反"代码里禁止字面量配色值"。
   已挪进 `skins` 库（`message.*` 五个 token），`ScenePlan.noteColors` 解析后下发。
   顺带发现那两色里有一个**与 `role.lead` 撞色**（纸条和角色圆点会同时出现在画面上）。
   校验器也补了一条：皮肤包缺 `message.*` 时给 **warning**（缺的只是纸条颜色，
   用 error 会让世界建不出来，代价不成比例），并列出缺了哪些。
3. **纸条互相盖住**。同一 tick 发出的多条纸条（一个人刚完工汇报、同时把活交接出去）
   起点完全相同，后画的把先画的整个盖住。**这是用像素计数发现的**：
   报告色的像素数是 0，而肉眼扫截图只会觉得"只有一张纸"。已按序错开。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 182 / pass 182 / fail 0
```

162 → **182**。有几条测试是**改断言而不是改实现**，每一处都核过是"期望该变"：

- **事件量那条我原来的断言是错的**。它写的是 `world.seq < EVENT_RING_SIZE`
  （2000 tick 的总数小于缓冲上限），当时能过只是因为**世界半静止**。
  待命的人开始走动之后它就红了，而红得对——**它把「速率」和「历史深度」混成了一件事**。
  现在分开断言：速率 `< 1.5/tick`（实测 0.33），且环形缓冲至少装得下 300 tick 的历史。
  还加了一条"速率不为 0"防止死世界假通过。
- **「没人动就不发帧」**：待命的人现在会自己走去歇脚点，所以"把 state 设成 idle"
  不再等于"没人动"。测试改成把歇脚点放在他们现在站的地方。
- **一个测试的前提不严**：我原本断言"所有初始待命的人最终都到歇脚点"，
  结果红在一个被反复派活的角色上——有活干的世界里那不是一个确定成立的性质。
  改成用**没有工单**的世界单测这个机制。

浏览器实测（真实 HTTP + 真实暂停命令）：等到**3 张纸条同时飞行**的那一刻按暂停，再数像素——
`tick 647 · 已暂停 · 飞行中纸条 3`，纸条像素 `handoff 133 / report 63`，**两种颜色都在**。
状态栏的 `事件 647 步` 与 `tick` 完全一致（上面第 2 个缺陷的验证）。

### 下一轮从哪继续

**路 A 依然被网络卡住**，所以仍然两条路：

**路 A（网络恢复）**：按 BACKLOG「M4 前置」那节的两条硬标准搜现成场景。
判据一句话：**它是不是「给什么数据就摆什么」？** 是 → 能用；不是 → 只能借风格与资产。
许可证只接受 MIT / Apache-2.0 / CC0。搜到填 `docs/ASSETS.md`，**不要重新调研**已有结论。

**路 B（仍然断网）**：用本机那份 `three@0.167.1` 走 vendoring 起 3D。具体步骤见 R9 的台账。

**不受网络影响、随时可做的（按我的优先序）**：

1. **M3-1 落盘**（`src/store/worldStore.ts`）：`world.json` 原子写 + `events.jsonl` 追加。
   现在世界只活在内存里，进程重启归零。注意 `world.messages` 现在**真的会有内容**了
   （R10 之前它永远是空的），所以落盘时**必须**把它一起写进去，否则重启后飞行中的纸条全没了。
2. **M3-4 SSE**：`GET /api/events` + 面板从轮询改成 `EventSource`。
   `protocol/wire/messages.ts` 的 `hasSeqGap` 已经写好并有测试，接上即可。
3. **M1.6-7 JSON 路径安全**：`ModelEntry.source.url` 现在可以是任意字符串。
   **M4 真正加载 GLB 之前必须落地**——无论走 A 还是 B，M4 都会读模型 URL。

### 假设

- **用户选「路 A」指的是"优先去搜现成场景"，而不是"现在就可以搜到"**。
  我没把它理解成"不用管网络"，所以先重测了三次网络才下结论。
- **`hangout` 放在 `Agent` 上而不是新开一个"待命点"内容库**。理由：广场地块本身已经是内容
  （有人想改的是"广场在哪、多大"，而那已经可配）。真要精确控制每个点，再抽库不迟——
  已记成 M2.6 之外的待定项。
- **消息正文暂时由内容标题拼**，连接符留在代码里。这条**可能触碰红线**
  （用户可见文案本该可替换），已明确记成 M2.6-1 待定，没有假装它没问题。

### 卡住 / 风险

- **M4 硬卡在网络**（第三次确认）。这不是"再试一次"能解决的。
  要推进 M4，需要用户二选一：恢复网络，或同意 vendoring `three@0.167.1`（先不做 bloom）。
- **`world.messages` 现在会增长**：已有上界（200，只裁已送达），但它进不进 `world.json`
  是 M3-1 必须一起定的——**否则重启后一张纸条都不剩**，而画面上"纸条飞过"这件事
  是用户能看见的少数几个协作信号之一。
- **`web/app.js` 仍然是手写 JS、没有类型**，`ScenePlan` 的形状有两份手工对应
  （TS 类型 + `app.js` 的字段读取）。这一轮又加了一层（`noteColors`、`messageDeliveryTicks`），
  **再加就该动手把它改成 TS + 构建**，否则迟早对不上。

### 本轮产出

- 新增：`src/sim/{idle,comms}.ts`、`test/idle-comms.test.js`
- 修改：`src/domain/{types,geometry,constants,index}.ts`（`hangout` / `messageSeq` /
  `MESSAGE_KINDS` / `latticeIn` / `MESSAGE_RING_SIZE`）、`src/sim/{mailbox,emit,step,index}.ts`、
  `src/world/create.ts`、`src/content/{registry,instantiate,packs/default}.ts`（纸条配色进内容 +
  `message.*` 校验）、`src/protocol/{scene,ports/runtime,wire/messages}.ts`、
  `src/runtime/index.ts`、`src/routes/api.ts`、`web/app.js`（纸条绘制 + 错开 + 超时 +
  过期提示）、`test/{step,scene-plan,http,dispatch-runtime}.test.js`
- 文档：`BACKLOG.md`（M2.5-1/2 done、新增 M2.6 四条、网络仍断）、`PROGRESS.md`
- 测试从 162 → 182

---

## R9 — 2026-10-15 · 场景描述层（为"用现成场景"铺前提）+ 断网这件事

**本轮请求**：用户说"如果能用 github 现成的游戏场景就直接用，可以搜一下"。

**先说结论：搜不了。** 本机**完全没有外网**，证据如下（全都试过）：

| 通道 | 结果 |
|---|---|
| `web_search` 工具 | 401，端点配错（`api.deepseek.com/anthropic/v1/messages`）。**这是用户设置里的项**（Settings > Plugins > Plugin configuration > Web search），不该我改 |
| shell 直连 `api.github.com` | `curl: (35) SSL_ERROR_SYSCALL`——DNS 解析得出 IP，TLS 握手就断 |
| shell 直连 `registry.npmjs.org` | `HTTP 000`（R1 时它是通的，现在不通了） |
| 浏览器 `github.com` | `net::ERR_CONNECTION_CLOSED` |
| `curl http://example.com` | `000` |
| 视觉后端 | 也全是 `fetch failed` |

所以 **M4 卡在网络**上：`three` 装不上（pnpm store 里连它的 metadata 都没有，
`--offline` 直接报 `ERR_PNPM_NO_OFFLINE_META`），现成场景也搜不到。

### 但本轮没白过：找到了一个本机可用的 three.js，并做掉了 M4 的前置

1. **本机已有 `three@0.167.1`（MIT）**：`/Users/kp/DEV/msim-front-react-workspace-2/node_modules/three`，
   含 `three.module.min.js`（684KB）与 `examples/jsm/controls/`（OrbitControls 等）。
   **一个真实的版本坑**：`ASSETS.md` 记的 `postprocessing` peer 范围是 `three >=0.168 <0.187`，
   而这份是 **0.167.1，差一个 minor 进不去**。所以要离线走 M4，得在
   "用 0.167.1 且先不做 bloom" 与 "等联网装 0.186" 之间选一个。**这个选择留给用户**，
   因为它影响画面（bloom 是"好看"的一部分）。
2. **M4-0：场景描述层**（`src/scene/plan.ts` + `src/protocol/{scene,theme}.ts`）。

### 为什么先做场景描述层，而不是硬啃 three

用户要的是"**直接**用现成场景"。但现成场景都自带烘死的布局，而我们的布局来自内容库。
硬接的后果是"改一次内容要改一次代码"——**直接踩中本研究的第一条红线**。

所以先把渲染器的输入定成一份中立描述 `ScenePlan`（"要摆什么"：地块/站点/角色，
颜色与主题**已经解析完**）。于是：

- 换成现成的 three.js 场景 = 让它消费 `ScenePlan`，**模拟层与内容库一行不用改**；
- 我们自己写程序化场景 = 也消费它；
- 将来的 Godot 客户端 = 还是消费它（决策 D2 那句"渲染层可整个替换"到这里才真的成立）。

**而且它是个纯函数**——不依赖 three.js、不碰 IO，所以**断网也能做完、能验**，
且不管用户最后选中哪个场景都不会返工。这是本轮刻意挑它的全部理由。

顺带把 `themes` 库真正接通了：`ContentPort.themeFor(sceneId)` 把自由形状的主题条目
映射成渲染就绪的 `ThemePlan`（相机/雾/三光源/后处理，**色值全部解析完**）。

### 动手时踩到、并且被自己的检查器抓住的两件事（都值得记）

1. **反向依赖**：我一开始把 `ScenePlan` 的类型写在 `scene/plan.ts` 里，
   于是协议层为了声明快照的 `scene` 字段不得不 import 场景层——
   `[type-import] protocol/wire/messages.ts → ../../scene/plan.js`，
   **边界检查器当场报错**。修法是把类型搬进 `protocol/scene.ts`（它是跨进程契约），
   只留派生逻辑在 `scene/`。判据很好用：**谁被跨进程引用，类型就归谁**。
2. **`skin.` token 的解析器差点有两个实现**（场景层一个、内容层映射主题时一个）。
   两个实现一定会漂移，而漂移的症状是"某处少了一个颜色"，很难归因。
   已经统一到 `protocol/scene.ts` 的 `resolveColor`。
3. 顺带归位：`boundsCenter` 从 `content/instantiate.ts` 移到 `domain/geometry.ts`——
   它是纯几何，不该让场景层"为了算一个中心点去 import 整个内容层"。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 162 / pass 162 / fail 0
```

152 → **162**。新测试里有两条是刻意的"防退化"：

- **颜色不许有 token 泄漏**：遍历 `ScenePlan` 里所有颜色，逐条断言匹配 `#rrggbb`，且
  **不许出现洋红**（洋红 = 解析失败）。漏解析任何一处都会红。
- **纯函数**：同输入两次结果一致，且 `JSON.stringify(world)` 在调用前后不变。

面板也改成消费 `ScenePlan` 了——**这是那层缝是不是真的的证据**：2D canvas 与将来的
three.js 吃同一份描述，而 `web/app.js` 里的 token 解析代码**已经全部删掉**。
浏览器里实测：画布 2112×1403、182 种颜色、四个地块色各占 14.4%、
状态栏 `tick 564 · 运行中 · seq 275`，内容行现在会显示主题
（`舒适等距沙盘（orthographic 45°/35.264°）`）。

### 下一轮从哪继续

**取决于一件事：联网能不能恢复。** 两条路都写清楚，谁先满足就走谁。

**路 A（联网恢复）—— 按 BACKLOG 的 M4 前置那节的两条硬标准去搜现成场景。**
判据一句话：**它是不是"给什么数据就摆什么"？** 是 → 能用；不是 → 只能借风格与资产（方式 A/B）。
许可证只接受 MIT / Apache-2.0 / CC0。搜到之后填 `docs/ASSETS.md`，**不要重新调研**已有结论。

**路 B（仍然断网）—— 用本机那份 `three@0.167.1` 往前走**，具体：

1. `pnpm add three@0.167.1 --offline` 不行（store 里没 metadata），所以走
   **vendoring**：按本仓库既有约定把 `three.module.min.js` 放到 `src/vendor/three/`，
   连同 `LICENSE` 与 `README.md`（记版本、来源、sha256、许可证）。`docs/DIRECTORY.md`
   里"面板第三方资源（vendored）"一节就是为这种事写的。
2. **先不做 bloom**（0.167.1 进不去 `postprocessing` 的 peer 范围）。主题里的
   `post.bloom.enabled` 保持 false —— 内容里已经有这个开关，所以之后接上不用改代码。
3. 然后 M4-1：`web/scene/` 里写渲染器，输入就是 `snapshot.scene`（`ScenePlan`）。
   **不要直接读 `snapshot.world` 的几何字段**——那等于绕过了刚建好的那层缝。

**与上面无关、随时可做的（优先做，因为不受网络影响）**：M3-1 落盘、M3-4 SSE、
M2.5-1（空闲角色叠在广场）、M2.5-2（邮箱没有发送方）。

### 假设

- **断网是环境问题，不是配置问题**（DNS 通、TLS 断、npm 与 GitHub 同时不通）。
  所以我按"离线优先"安排本轮：挑了一件不依赖网络、且无论联网与否都不会返工的事。
- **`ScenePlan` 的形状是对的**：它是渲染器的**唯一**输入，`world` 只留给 HUD 的文本内容。
  这个划分如果错了，代价是 M4 写起来别扭——但不会破坏任何已验的逻辑。
- **`three@0.167.1` 够用**：我们需要的是 WebGLRenderer / OrthographicCamera /
  InstancedMesh / GLTFLoader / SkeletonUtils / AnimationMixer / OrbitControls，这些在 0.167 都有。
  唯一受影响的是 `postprocessing`（bloom），而那本来就标着"可选"。

### 卡住 / 风险

- **M4 硬卡在网络**。这不是"再试一次"能解决的：store 里没有 `three` 的 metadata，
  离线装不了；也没有任何现成场景可用。**要么联网，要么走 vendoring**（上面路 B），
  而 vendoring 需要用户在"0.167.1 且暂无 bloom"与"等联网装 0.186"之间拍一下板。
- **`web_search` 是坏的，且只有用户能修**（端点配成了 DeepSeek 的 Messages API）。
  在修好之前，任何"搜一下"的请求我都只能用 shell/浏览器直连，
  而它们现在同样不通。**这三件事是同一个病根：这台机器现在没有可用外网。**
- **临时验证服务器还在跑**（PID 变了，端口仍 18437）。它跑的是一个脚本构造的世界，
  **不是装进 profile 的真插件**——用户现在看到的页面不等于"插件能用了"。
- **`web/app.js` 仍是手写 JS、没有类型**。`ScenePlan` 的形状现在有两份手工对应：
  TS 类型与 `app.js` 里的字段读取。M4 若改成 TS + Vite，应当直接从 `protocol/` import 类型，
  把这份手抄的契约消掉——也顺便解决 `world.tick` 帧事件的元组数组那个隐式契约。

### 本轮产出

- 新增：`src/protocol/{scene,theme}.ts`、`src/scene/{plan,index}.ts`、`test/scene-plan.test.js`
- 修改：`src/protocol/{index.ts,wire/messages.ts,ports/content.ts,boundaries.ts}`（新模块 `scene` 登记进规则表）、
  `src/content/port.ts`（`themeFor` + 复用 `resolveColor`）、`src/domain/geometry.ts`（`boundsCenter` 归位）、
  `src/routes/api.ts`（快照带 `scene`）、`web/app.js`（改为消费 `ScenePlan`，删掉全部 token 解析）
- 文档：`ARCHITECTURE.md`（§10 + 决策 D23/D24、决策表按编号重排）、`BACKLOG.md`
  （M4-0 完成 + "现成场景"的两条硬标准与三种可行方式 + 断网约束）
- 测试从 152 → 162

---

## R8 — 2026-10-15 · HTTP 面板：**终于有一个能看的页面了**

**本轮目标**：把"能不能看见"这件事解决掉。上一轮我给了用户两条路并建议先出可见版本；
用户没有回，按纪律"缺信息不要停下来等人"，就按自己给出的建议推进（理由见下面「假设」）。

### 做了什么

1. **`src/routes/router.ts`** —— 极小的 HTTP 路由表（`:name` 段匹配、JSON 体解析带
   64KB 上限、异常翻状态码）。没引框架：需求只有三条，而这几条不到 150 行。
2. **`src/routes/api.ts`** —— `GET /api/world` 快照 + `POST /api/command`。
   两个刻意的决定：
   - **快照里没有 `world.events`**。面板要轮询它，带上最近 500 条事件会让一个快照到几百 KB，
     而面板根本不需要历史（历史走 SSE 增量）。
   - **命令入队，不立刻执行**。它要经下一步 `step()` 的 ingest 段才生效；否则世界的表现
     会取决于 HTTP 请求到达的瞬间，直接破坏确定性。有一条测试专门断言"POST 之后世界没动"。
3. **`src/routes/panel.ts`** —— 静态服务。三条必须自己做的事：**按规范化后的绝对路径判越界**
   （不是字符串里找 `..`——那样 `%2e%2e%2f` 会漏）、**MIME 白名单**（不猜类型，
   没想到的扩展名默认拒绝）、**不做 SPA 回退**（宿主的 fallback 座位已被官方 SPA 占用）。
4. **`web/`** —— canvas 俯视图 + 右侧花名册/工单板 + 暂停/继续按钮。**轮询**而非 SSE
   （SSE 是 M3-4，还没做）。
5. **只占一个路由座位**：整个插件在宿主 `webServer` 上注册**一个** `/agent-world` 前缀路由，
   所以与别的插件不可能撞（而 `register` 撞了是会抛的）。
   **前缀按整段匹配**：`/agent-world-x` 不属于本插件——只做 `startsWith` 会吞掉相邻插件的路径。
6. **`webServer` 是软依赖**：用 `ctx.inject` 而非顶层 `inject`。写进顶层会让插件在 headless
   profile 里直接加载失败，而"世界能不能跑"和"有没有人看"本来就不该绑在一起。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 152 / pass 152 / fail 0
```

132 → **152**。HTTP 那组用**真服务器**（端口 0）而不是假 req/res：这一层的活儿就是
"把 Node 的请求对象变成响应"，用假的等于把要测的东西替换掉了。最该看的几条：

- **路径穿越必须被挡住**：`/../secret.txt`、`/sub/../../secret.txt`、以及**编码过的**
  `/%2e%2e/secret.txt`——最后这条是"用 `includes('..')` 实现"会漏掉的。
- **只服务白名单类型**：`.env` / `.sqlite` / 无扩展名一律 404，且报错要**列出允许的扩展名**。
- **`/agent-world-x` 不被吞掉**。
- **POST 命令之后世界没动**，推进一步才生效。
- **`apply` 真的注册了一个前缀路由**，且清理链能走到它的 disposer（热重载不泄漏）。
- **没有 `webServer` 时不注册也不报错**（软依赖的真实语义）。
- **端到端**：把 `apply` 注册的那个处理器挂到真服务器上，页面与 API 都取得到。

然后**真的在浏览器里看了一遍**（临时服务器 18437，截图见本轮交付）。视觉后端本轮不可用，
所以改用**程序化核验**，比看截图更严格：

```
画布 2112×1403 · 218 种颜色
四个地块色各占 14.4%：#6F7D5A / #5C6B78 / #8A7A5C / #7D6F5A  ← 与调色板逐字对得上
状态栏：tick 1186 · 运行中 · seq 653 · 事件 1186 步 · 待命 6 干活 2
花名册 8 行 · 工单板 10 行 · 内容：pack.default@1.0.0 — 十个库都在
```

### 下一轮从哪继续

**M3-1：落盘（`src/store/worldStore.ts`）。** 现在世界只活在内存里，进程重启归零。具体：

1. `world.json`：**原子写**（写临时文件 + `rename`；直接覆盖的话，写到一半断电会留下半截 JSON，
   而下次启动会解析失败）。
2. `events.jsonl`：**追加**。注意 `world.events` 是环形缓冲（只留 500 条），
   所以落盘不能"把缓冲写出去"——那样历史会在第 501 条事件时开始丢。
3. 两条欠账在落盘时一起定：`world.messages` 只增不减；`origin.packs` 要把**版本**也存下来，
   让"这局用的是哪个版本的内容"可查。
4. `store/` 的边界：只许 import `protocol` 与 `domain`，允许 `node:`。

之后 **M3-4（SSE）**：`GET /api/events` + 面板从轮询改成 `EventSource`，
并处理 `hasSeqGap` 的重新拉快照。`protocol/wire/messages.ts` 里的 `hasSeqGap` 已经写好并有测试，
接上即可。

### 假设

- **用户没回上一个问题，我按自己给出的建议推进**（先出可见页面，再补落盘）。
  理由是那条建议本来就写明了"不浪费"：HTTP 快照、SSE、静态服务、MIME 白名单、穿越防护
  ——M4 一条也少不了。**如果用户其实想先要落盘（重启不丢世界），那只是把 M3-1 往后挪一轮，
  没有返工。** 这是本轮最该被复核的一个决定。
- **面板先用轮询**。SSE 是 M3-4，没做之前轮询是唯一选择；而且轮询版能立刻验证
  "快照 + 命令"两条链路。代价是 400ms 一次全量快照——世界小，够用。
- **静态面板服务的是 `lib/web/`**（由 `scripts/copy-web.mjs` 从 `web/` 同步），不是 `web/` 本身。
  因为 profile 安装是硬链接副本、`files` 白名单只含 `lib/`——服务 `web/` 会踩
  "新增文件没被同步进 profile"的坑（DEVELOPMENT.md §7）。M4 换成 Vite 构建时这一步自然演化成打包。

### 卡住 / 风险

- **用户现在看到的页面是我起的临时服务器**（PID 34809，端口 18437），**不是真装进 profile 的插件**。
  它跑的是一个脚本构造的世界，而且进程一停页面就没了。要真的在 GUI 里看到，得先
  `dsh plugin --profile web add`（而根 `pnpm install` 目前是坏的，这条路径**还没验证过**）。
  这是"能不能看"与"装好了没有"之间的差距，必须说清楚，别让临时服务器造成"已经装好了"的错觉。
- **轮询会打满一个核吗**：400ms × 一个完整快照。世界小的时候无所谓，角色到 24 人、
  任务上百时值得重新量。M3-4 换 SSE 之后就没了。
- **面板没有"断线"的表现**：轮询失败只改状态栏文字，画布保持最后一帧。看起来会像世界卡住。
  已排成 M3-6。
- **`web/app.js` 是手写 JS，没有类型**。它引用的形状（快照字段、事件载荷、元组数组）
  现在写在 `docs/PROTOCOL.md` §4.4——**那份文档是它唯一的契约**。M4 若改成 TS + Vite，
  应当直接从 `protocol/` import 类型，把这份手抄的契约消掉。

### 本轮产出

- 新增：`src/routes/{router,api,panel,index}.ts`、`src/protocol/ports/runtime.ts`、
  `web/{index.html,app.js,style.css}`、`scripts/copy-web.mjs`、`test/http.test.js`
- 修改：`src/protocol/{index.ts,wire/messages.ts,ports/content.ts}`（快照载荷、`RuntimePort`、
  `ContentPort.colors`）、`src/content/port.ts`、`src/runtime/index.ts`（实现 `RuntimePort` +
  命令队列）、`src/index.ts`（挂 HTTP）、`package.json`（`build` 含 `build:web`）、
  `test/{smoke,external-pack,dispatch-runtime}.test.js`（假 ctx 补 `inject`）
- 文档：`PROTOCOL.md`（§4.4 载荷形状 + §4.5 HTTP 端点）、`ARCHITECTURE.md`（§10 + D21/D22）、
  `BACKLOG.md`
- 测试从 132 → 152

---

## R7 — 2026-10-14 · 派单工具 + 运行时（**世界开始自己动了**）

**本轮目标**（M2-9 / M3-2）：让任务库被真正消费，并补上从 R6 起就缺的那个环节——**驱动 `step()` 的人**。

### 做了什么

1. **`state.dispatch(taskSet)`（M2-9）** —— 从内容库取一条工作流，实例化成世界的工单。
   - 序号接在**既有工单的最大 `ordinal`** 之后，而不是 `tasks.length + 1`：
     后者只在序号连续时等价，将来一旦有归档/删除就会撞 id。
   - 同一套工作流可以派多次（做第二个功能），id 不撞，有测试。
   - 端口签名从计划里的"返回 World"改成返回 `DispatchOutcome`
     （新增工单 id / 该工作流几步 / 派完总数）——工具要能把这些话**原样说给模型听**。
2. **`ContentPort.entryIds(kind)`** —— 加它有一个很具体的理由：派单时用户给了不存在的任务集 id，
   报错必须**列出可用的任务集**。"没有这个 id"帮不了任何人。顺便 `agent_world_content kind=tasks`
   现在会列出条目数。
3. **`src/tools/dispatch.ts`** —— `agent_world_dispatch`。只 import `protocol/`，
   真正的实现在 `state.ts`（它 import `content`，符合边界规则）。
   工具输出里有一句刻意的提示：**"派了不等于开工"**——否则模型会以为派完就做完了。
4. **`src/runtime/index.ts`（M3-2）** —— 每 `tickMs` 推一步的节拍器。三件事：
   - **处理 `StepResult.requests`**：`sim/` 按边界规则不许 import `content/`，
     所以 `reset`/`dispatch`/`hire` 是它转交出来的。运行时是**唯一**允许同时认识
     "模拟内核"与"内容服务"的地方，由它把它们接上。
   - **顺序：先 `reset` 再 `dispatch`**。反了会把单派进马上要被丢掉的那个世界。
   - **`hire` 在 M7 之前没人能做**，所以**计数**（`diagnostics.unhandledHires`）而不是静默丢弃——
     静默丢弃会让"我让招募一个人，它什么都没发生"无从解释。
5. **清理顺序是个真缺陷，测试抓到了**：我一开始写成"先 `start()` 再 `ctx.effect(清理)`"。
   这在本仓库是危险的：dsh 支持热重载，泄漏的 `setInterval` 会让"改一次代码多一个世界在跑"，
   而症状是 CPU 慢慢爬高——很难归因到某个插件。改成**先挂清理、再启动**。
   （顺带暴露了测试侧的一个坏习惯，见下面「卡住」第一条。）
6. **`agent_world_open` 的过期文案修掉了**：它还写着"模拟循环尚未接入"，现在是"用
   `agent_world_dispatch` 派一条工作流，派完不必催——模拟循环会自动把可领取的工单派给空闲的人"。
7. **顺手修掉一处记账错误**：`M1.5-4`（`agent_world_content` 工具）在 BACKLOG 里还是 `ready`，
   但它 R4 就实现了。已标 `done` 并注明。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 132 / pass 132 / fail 0
```

115 → **132**。最该看的是这三条：

- **"派单之后世界会自己把它做掉"**：派 quick-fix 进世界、缩短预估、`runtime.advance(3000)`，
  断言 3 张单全部 `done`。**这条是"没人驱动 step"那个缺口的修复证明**——
  R6 结束时同样的世界跑多久都是静止的。
- **"先重开再派单"**：把顺序反了会把单派进马上丢掉的世界，测试直接钉住顺序。
- **"step 抛异常不拖垮循环"**：造一个 `tasks: null` 的破世界，断言 `errors` 计数 +1、
  `ticks` 不增加、回调被调用。循环活着比崩掉重要，但**不能静默活着**。

### 下一轮从哪继续

**M3-1：落盘（`src/store/worldStore.ts`）。** 在那之前世界只活在内存里，进程重启就归零。
具体：

1. `world.json`：整世界快照，**原子写**（写临时文件 + `rename`，不要直接覆盖——
   写到一半断电会得到一个半截的 JSON，而下次启动会解析失败）。
2. `events.jsonl`：事件追加。注意 `world.events` 是**环形缓冲（只留 500 条）**，
   所以落盘必须是**追加**而不是"把缓冲写出去"——否则历史会在第 501 条事件时开始丢失。
3. 之前记下的两条欠账，落盘时要一起定：
   - **`world.messages` 只增不减**（不像 `events` 有环形缓冲）。要么截断、要么归档、要么只留未送达 + 最近 N 条。
   - **`world.tick` 帧事件的载荷是元组数组**，过 JSON 会变普通数组。接 SSE 前必须把它写进
     `docs/PROTOCOL.md` 的载荷说明，否则面板只能靠读源码猜形状。
4. 恢复路径：`origin.packs` 记着"这局是用哪些包装的"。**内容变了、旧存档的表现就会变**，
   这是可接受的（内容升级本来就该改变表现），但要把 pack 版本一起存下来，让"这局用的是哪个版本的内容"可查。
5. 注意 `store/` 的边界规则：只许 import `protocol` 与 `domain`，允许 `node:`。

### 假设

- **`autoStart` 的语义终于定死**：世界**总是**先建出来（这样 `agent_world_status` 立刻有东西可看），
  `autoStart` 只决定要不要开始推进。之前那条"不要实现成不建世界"的注释现在有了正式语义。
- **运行时不做业务判断**：谁该做哪张单是调度器的事，它只管按节拍推、把转交的请求接上。
- **`start()`/`stop()` 幂等**，且与 `advance()` 不冲突（手动快进不会改变自动推进的状态）。
- **定时器不 `unref`**：dsh 是长驻服务进程，需要它保持事件循环。测试侧靠 `after()` 统一清理。

### 卡住 / 风险

- **本轮最大的教训在测试侧**：假 ctx 的 `effect` 一开始写成"立刻执行清理函数"，
  而 `apply` 是"先挂清理、再启动"。两者一撞，清理跑在启动之前 → 定时器泄漏 →
  **`node --test` 整个不退出**。而它表现为"测试跑了 5 分钟还没结束"，
  报错却是 `Promise resolution is still pending but the event loop has already resolved`，
  指向"某个测试的 promise 没 settle"——**完全指错方向**，我是靠逐个文件探测才定位到的。
  已改成"假 ctx 收集清理函数、`after()` 统一执行"，并把这条写进了两个测试文件的注释里。
  **结论：假的依赖必须镜像真实的生命周期语义**，否则它要么掩盖 bug、要么造出假 bug。
- **`diagnostics` 目前没有出口**：运行时持有它，但没有任何工具/HTTP 能读到。
  想回答"它到底在跑吗"只能看日志。M3-3 加 HTTP 时应当把它暴露成 `GET /api/world` 的一部分。
- **`apply()` 里 `runtime` 只活在闭包里**，外部拿不到它。工具要触发"暂停/恢复"得走
  `agent_world_*` → `StepResult.requests` 这条路（`pause`/`resume` 已经在 ingest 段实现了，
  但没有对应的工具）。这是 M6-4 控制条要接的口子，先记着。

### 本轮产出

- 新增：`src/runtime/index.ts`、`src/tools/dispatch.ts`、`test/dispatch-runtime.test.js`
- 修改：`src/protocol/ports/{content,world-service}.ts`（`entryIds` / `dispatch`）、
  `src/content/port.ts`、`src/state.ts`、`src/index.ts`（运行时装配 + 清理顺序）、
  `src/tools/world.ts`（过期文案）、`test/{smoke,external-pack}.test.js`（假 ctx 补 `effect`）、
  `docs/BACKLOG.md`（M1.5-4 记账修正、M3-2 依赖写错的修正）
- 测试从 115 → 132

---

## R6 — 2026-10-14 · 事件产出 / 邮箱 / step 编排 / 1000 tick 确定性验收

**本轮目标**（M2-6 / M2-7 / M2-3 / M2-8）：把 M2 收口。**模拟内核到此完成。**

### 做了什么

1. **`src/sim/journal.ts`（M2-7）** —— `emitEvent(world, type, payload)`，**只有它能改
   `world.seq` 与 `world.events`**。事件序号是客户端 gap 自愈的依据（PROTOCOL.md §4.3），
   多处各自造序号会让序号重复或跳号，而症状是"面板偶尔重拉一次快照"——没人会去查。
2. **`src/sim/emit.ts`（M2-7）** —— 把各段返回的 outcome 翻成事件。
   **整个内核的事件只从这一处产出**；四个阶段函数刻意都不发事件。
3. **事件量策略（R5 留下的最大不确定性，本轮定了）**：

   | 事件 | 频率 | 为什么 |
   |---|---|---|
   | `world.tick` | 每 tick **最多一条**，且只在真有位移时 | 位置是连续量。一条"帧"事件带本 tick 有位移的角色 `[id,x,z,facing][]`，而不是每人一条——后者 24 角色 ≈ 240 条/秒，环形缓冲只有 500 条 |
   | `task.changed` | 状态变化 + **每 10% 里程碑** | 进度条自己插值；每 tick 推 24 条进度是纯浪费 |
   | `agent.state` / `message.sent` | 离散 | 本来就稀疏 |
   | `agent.moved` | **保留但不再使用** | 位置走帧事件。留着一个"单个角色大跨度移动"的位置，也避免删枚举取值（那要 bump 协议版本） |

   **`stalled` 刻意不发事件**：它是"为什么现在派不出去"的诊断，没空闲角色时每 tick 都成立，
   发出来只会刷屏。由 `step()` 的返回值交给编排层。
4. **`src/sim/mailbox.ts`（M2-6）** —— 消息有**定量投递延迟**（`MESSAGE_DELIVERY_TICKS = 10`，
   ≈1 秒）。留在常量里而不是由内容决定：它是模拟的时间语义，不是可替换的美术。
   消息 id **不从事件 seq 派生**——混用会让"事件序号不跳号"这条保证失效，有测试钉住。
5. **`src/sim/step.ts`（M2-3）** —— 六段固定顺序。两处值得说：
   - **签名去掉了 `dt`**（决策 D20）：这是定步长模拟，一次调用 = 前进一 tick，
     `dt` 永远等于 `tickMs`。收了却不用它只会让人以为"传别的值会改变结果"。
   - **`reset` / `dispatch` / `hire` 不在内核里执行，而是放进 `requests` 转交编排层**。
     这三个都需要内容（场景/任务集/花名册），而 `sim/` 按边界规则不许 import `content/`。
     这不是权宜之计，是 D16 那条规则在起作用；顺带的好处是 `step()` 可以在
     **没有任何内容注册表**的情况下被测试。
   - `world.tick` 在**最后**自增：上面所有阶段读到的都是"这一步的编号"，事件时间戳因此一致。
     放开头加会让事件落在下一个 tick 上，差一帧。
6. **修掉一个真实缺陷（测试抓到的）**：`movement.ts` 原本要**等下一 tick** 才判定到站，
   于是会出现一帧"状态还是 walking、位置已经到了"——渲染层那一帧不知道该播走路还是坐下，
   看起来像慢了一拍。改成**走到最后一个点的当 tick 就到站**。
7. **`test/determinism.test.js`（M2-8）** —— 1000 tick 逐字节比对，外加三条"防止假通过"的检查。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 115 / pass 115 / fail 0
```

91 → **115**。M2-8 那组特别值得看，因为**确定性测试最容易假通过**：

- **1000 tick 逐字节一致**（`JSON.stringify` 比对，同时覆盖"值不同"与"字段顺序不同"）。
- **加一条"世界确实在动"**：如果世界是死的，上一条会因为"两边都是初始状态"而假通过。
  所以断言 1000 tick 后有角色在工作、有工单完工、产生过事件。
- **加一条静态检查**：直接读 `src/sim/*.ts` 源码（**去掉注释再查**），
  出现 `Math.random` / `Date.now` / `new Date` 就红。注释里正当地写"禁止 Math.random"
  不该被判成违规——这个细节不做，这条检查会立刻变成噪声被关掉。
- **加一条 3000 tick 长跑**：事件缓冲有界、状态机取值合法、进度不越界、
  **不许有角色卡在 walking 却没目标**（静默卡死）、进行中的工单必须有负责人与站点。
- **加一条完整流水线**：quick-fix 三张单全部完成，且**完工后没人还占着工位**。

另有两条关于"事件量策略真的生效"的检查：400 tick 只产生 133 个事件（帧事件只在有人移动时发）；
2000 tick 的 `seq` 仍远小于缓冲上限 500。**如果按人头逐条发位置事件，这两条会当场红。**

三处测试写错、**实现是对的**（记在这里免得下次重写）：
① 我断言 `resume` 那一步不推进世界——实际它推进了，且**这是对的**（命令影响它到达的那一 tick）；
② 环形缓冲断言差一（`world.seq` 从 1 起，不是 0）；
③ 邮箱测试忘了推进 `world.tick`，时间不走消息当然不送达。

### 下一轮从哪继续

**M2-9：`agent_world_dispatch` 工具**，让任务库真正被消费。具体：

1. `WorldServicePort` 加 `dispatch(taskSetId: string): World`（或返回新派进的工单 id 列表）。
   **必须在 `state.ts` 里实现**（它 import `content`，符合边界规则），工具侧只调端口。
2. 复用 `content/instantiate.ts` 的 `instantiateTasks(set, startIndex, tick)`——
   `startIndex` 要接着现有 `world.tasks.length + 1`，否则跨任务集会撞 id。
3. 新建 `src/tools/dispatch.ts`，注册 `agent_world_dispatch`。工具描述要写明副作用
   （**会往世界加派工单**）。参数 `taskSet` 要校验：库里没有就报错并**列出可用任务集**。
4. 测试：派 quick-fix 进世界 → 工单数 +3、首张 `ready`、id 不撞已存在的。
5. 顺带把 `agent_world_open` 的说明改掉——它现在说"等 lead 派单"，但派单工具就是这一个。

**然后 M3**。M3 的第一件事应该是 **M3-2 runtime**，而不是 M3-1 落盘：因为
**现在没有任何东西驱动 `step()`**，插件加载后世界是静止的（`world.tick` 一直是 0）。
先把 tick 循环接上，世界才真的会动：

- `src/runtime.ts`：`setInterval(step, tickMs)` + `ctx.effect(() => () => clearInterval(...))` 清理
  （**必须清理**，否则热重载会泄漏定时器，这是本仓库的既有踩坑）。
- 处理 `StepResult.requests`：`dispatch` / `hire` 需要内容，`reset` 要么重建世界要么明确拒绝。
- `autoStart` 配置项**终于有了真实语义**（之前只是"先把世界建出来"）。
- 注意：runtime 属于 `runtime/` 模块，边界规则允许它 import 全部；但 `sim/` 不许反过来 import 它。

### 假设

- **`world.tick` 在暂停期间不前进**，且暂停时 `step()` 除了 ingest 段什么都不做。
  这样 HUD 上不会出现"暂停了但时间还在走"。
- **消息投递延迟 10 tick 是定数**，不随内容变化。真要改观感，改的是渲染层怎么插值这段飞行。
- **进度事件只在里程碑发**，所以面板的进度条**必须自己插值**，不能指望收到每一帧的进度。
  这条要写进 M4/M6 的实现说明里，否则做 HUD 的人会以为"进度事件丢了"。

### 卡住 / 风险

- **最该记住的一条：`step()` 现在没有驱动者。** 内核对、测试全绿，
  但插件加载后世界静止（`world.tick` 一直是 0），工具看到的是一个"装好了但还没开始跑"的世界。
  这不是 bug，是 M3-2 还没做——但**很容易被误读成"模拟已经能用了"**。已写进 BACKLOG 的 M3 抬头。
- **`world.messages` 只增不减**（不像 `events` 有环形缓冲）。一个跑很久的世界里消息会无限堆积。
  M3-1 落盘时必须定策略（截断 / 归档 / 只留未送达 + 最近 N 条）。现在没定，因为还没有长跑的真实场景。
- **`emit.ts` 里 `world.tick` 帧事件的载荷是元组数组**，过 JSON 会变成普通数组，
  反序列化方要按位置解包。这是个**隐式契约**，PROTOCOL.md 只写了"事件带 seq"没说载荷形状。
  M3 接 SSE 时必须把它写进 PROTOCOL.md 的载荷说明，否则面板只能靠读源码猜。

### 本轮产出

- 新增：`src/sim/{journal,emit,mailbox,step}.ts`、`test/step.test.js`、`test/determinism.test.js`
- 修改：`src/sim/{movement,interaction,index}.ts`（到站同 tick、progressed 带 delta）、
  `src/domain/{types,constants}.ts`（事件量策略注释、投递延迟、里程碑粒度）、
  `docs/ARCHITECTURE.md`（§4.1 签名 + 决策 D20）、`docs/BACKLOG.md`
- 测试从 91 → 115

---

## R5 — 2026-10-14 · 模拟内核的四个叶子：依赖求值 / 调度 / 移动 / 干活

**本轮目标**（M2-1 / M2-4 / M2-5 / M2-5b）：把"世界会动"这件事做出来。
四个阶段函数都是**纯的**（不碰 IO、不用未注入的随机与时间），各自可单独测。

### 做了什么

1. **`src/sim/ready.ts`（M2-1）** —— `ready` 状态的**唯一**实现点。
   强调"唯一"是因为：如果调度器、HUD、工具各自判断一次"依赖满没满足"，
   三处总有一天对同一张工单给出不同答案，而每处单独看都对——那种不一致最难查。
   两条刻意的语义：
   - **依赖指向不存在的任务 ⇒ 返回 false**（不是"当成没依赖"）。
     基于一个"消失了的前置"判断可以开工，比不开工更坏。
   - **`ready → pending` 的退回也有实现**：依赖被重新打开时，不让世界卡在
     "依赖没了但单还是可领取"这种自相矛盾的状态上。
2. **`src/sim/scheduler.ts`（M2-4）** —— 原子 claim。几条设计：
   - **"原子"靠结构保证，不靠时序小心**：一趟遍历里完成"挑单 + 挑人 + 挑站 + 写状态"，
     中途没有 await、也没有第二次遍历。一旦有，"两个人抢到同一张单"就会变偶发问题。
   - **容量把"正在过去的"也算上**：只看"已经在那里的"会让三个人同时被派到一张
     单人工位，到了才发现挤不下。
   - **座位在 claim 时定好并写进路径**：到达时再算会拿到不确定的序号。
   - 排序用 `ordinal` 而**不是 id 字符串**——`task-10` 的字符串序在 `task-2` 前面，
     那会让优先级在两位数时静默改变。
   - 职业匹配是**优先而不是门槛**：没有同职业的人就把单给任何空闲的人。
     否则一个小队只要缺某个职业，整条流水线就停在那里。
3. **`src/sim/movement.ts`（M2-5）** —— 只做位置推进，**不负责找路**（路径由调度器给）。
   好处：以后换网格 A\* 或 navmesh，改的是"路径怎么算出来"，"怎么沿路走"一行不动。
   一条防御：自称 `walking` 却没有（有效）目标 → **就地修好并报出来**。
   不修的话角色会永远卡在"走路"状态上不动——**静默卡死**是最难查的一类问题。
4. **`src/sim/interaction.ts`（M2-5b，本轮新增的任务）** —— 干活推进。三个决定：
   - **进度按内容库声明的 `estimateTicks` 走**：既然内容里写了"预估 600 tick"，
     就让它真的有意义。否则它只是个装饰数字，而"显示 3 分钟、实际 25 秒"比不显示还糟。
   - **完工即释放站点**：站点容量是稀缺资源（只有 4 张能写代码的工位）。
     如果干完活的人赖在工位上，高峰期会死锁——工位被"已经干完的人"占着，新工单永远派不出去。
   - **不做庆祝状态**：`celebrating` 留给渲染层对完工事件做反应。
     模拟内核不必多维护一个计时器，而"看起来在庆祝"本来就是表现层的事。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 91 / pass 91 / fail 0
```

70 → **91**。新增 21 个，每条都对应一个真实会踩的坑：

- 依赖指向不存在的任务 → **不开工**（而不是当成没依赖）
- 依赖被重新打开 → 已 ready 的单**退回 pending**
- 一张单在同一 tick 内只被派一次；同一个人不会被派两张
- **容量超了要 stalled 而不是硬塞**，且 stalled 的说明要指出缺的是什么能力
- **占位把"正在过去的"也算上**（这是最容易漏的一条）
- `pickStation` 要求**能力包含**而不是有交集（要求「评审+讨论」的单不能放到只有「评审」的桌上）
- 优先级按 ordinal：造 12 张单、3 个工位座位，断言拿到的是 `task-1/2/3`
  而不是字符串序的 `task-1/10/11`
- 位置**精确落位**（差一点点在渲染层看起来就是没坐下）
- 自称 walking 却无目标 / 目标站点不存在 → 修好
- 完工**释放站点**（断言 `occupancyOf` 回到 0）
- 四段串起来能跑通一条流水线（triage 完工后 patch 被接上）

两处测试写错、**实现是对的**，改的是测试（记在这里免得下次又写一遍）：
① 我给 12 张单都写了 `research` 能力，而实验台只有 1 个座位，所以只能派出去 1 张、
观察不到顺序——改成 `code`（3 个座位）才看得到有序前缀；
② `pickStation({ requires: [] })` 我写了个自相矛盾的断言（`null ?? 自己`），
实际行为是"落到第一个有空位的站点"（`every` 对空数组为真）——这是确定的、可接受的，
因为内容校验本来就**禁止**任务模板不声明能力。

### 下一轮从哪继续

**M2-7：`src/sim/journal.ts` + `src/sim/emit.ts`（事件产出）**，然后 M2-6（邮箱）、M2-3（`step`）、M2-8（确定性）。具体：

1. `src/sim/journal.ts`：`emitEvent(world, type, payload): WorldEvent` —— 取 `world.seq` 当序号、
   自增、push 进 `world.events`、超过 `EVENT_RING_SIZE` 从头部截断。**只有它能改 `world.seq`**。
2. `src/sim/emit.ts`：把四段返回的 outcome 翻成事件。类型用 `WorldEventType`
   （`agent.state` / `agent.moved` / `task.changed` / `message.sent`）。
   **注意别每 tick 发一堆 `agent.moved`**：位置每 tick 都变，那是高频事件（≤24 条/tick ≈ 240 条/秒），
   会给 SSE 与"环形缓冲只有 500 条"带来压力。**先定采样策略再写代码**
   （按位移阈值采样，或只在一个批里给最终位置），否则会在 M2-8 的对比里以"输出太大"暴露。
3. 四段函数**刻意都不发事件**（返回 outcome），事件只在 `emit.ts` 一处产出。
   别在 `ready.ts` / `scheduler.ts` 里顺手加 emit——那会让"事件从哪来"变成四个答案。
4. 然后 `src/sim/mailbox.ts`（M2-6）→ `src/sim/step.ts`（M2-3，六段顺序：
   `ingest → scheduler → movement → interaction → mailbox → emit`）→ `test/determinism.test.js`（M2-8）。
5. `step` 的签名与语义：`step(world, dt, commands) -> { world, events }`，**就地修改传入的 world
   并返回它**（"纯"指的是不碰 IO、不用未注入的随机/时间，不是不可变）。调用方要么拥有它，
   要么先克隆。这点要写在文件头，否则下一个人会以为它不修改入参。

### 假设

- **`sim/` 的路径目前是直线（一个座位点）**。小镇还没有障碍物，所以正确；
  真正的绕障在 M5-3（网格 A\*）。换的时候改的是"路径怎么算出来"，
  `movement.ts` 的推进逻辑不用动——这正是把找路与走路分开的收益。
- **`progress` 是增量累加**（每 tick `+1/estimateTicks`），不是由 tick 反推。
  浮点累加有误差，但同一个世界跑同样的步数得到同样的浮点结果，所以**确定性不受影响**。
  如果以后要"从任意 tick 直接算出 progress"，得改成按 `startedAtTick` 反推
  （那需要给 `Task` 加字段）——现在没这个需求。
- **完工的角色就地站住**（位置不动、`station` 清空）。"走回休息区"与"庆祝"都是表现层的事。

### 卡住 / 风险

- **事件量还是未知数**（见「下一轮」第 2 点）。这是本轮留下的最大不确定性：
  必须先定 `agent.moved` 的采样策略，否则 M2-8 的逐字节对比会因为输出太庞大而没法用。
- **`Task.ordinal` 是跨任务集连续的**（`instantiateTasks` 传的是全局 `tasks.length + 1`）。
  好处是全世界一个稳定序；代价是它**不表达**"在所属流水线里是第几步"。
  HUD 要画流水线内部顺序时得用 `set` + 集合内下标，不能直接用 `ordinal`。记在这里免得误用。
- 边界检查器对 `src/sim/` 的规则已生效（只许 import `protocol` 与 `domain`），
  所以 `journal.ts` / `emit.ts` **不许** import `runtime` 或 `content`——
  事件出口是 `EventSinkPort`（`protocol/ports/events.ts`）。

### 本轮产出

- 新增：`src/sim/{ready,scheduler,movement,interaction,index}.ts`、`test/sim.test.js`
- 修改：`src/domain/types.ts`（`Task` 加 `ordinal` / `suggestedRole`）、
  `src/content/instantiate.ts`、`src/domain/constants.ts`（`DEFAULT_TASK_TICKS`）、
  `docs/BACKLOG.md`（M2 构建顺序修正）
- 测试从 70 → 91

---

## R4 — 2026-10-14 · 契约层：模块之间只通过协议通信，且由机器强制

**本轮目标**（用户反馈驱动）："要各个模块解耦定好自己的协议或者 protobuf 通信，模块之间使用协议通信禁止耦合。"

### 先给结论：为什么不是 protobuf

用户说的是"定好自己的协议**或者** protobuf"。我的判断是**协议要，protobuf 现在不要**，理由不是省事：

1. **进程内的模块之间不该序列化**。`domain`/`content`/`world`/`sim` 之间是同进程函数调用，
   套一层 protobuf 只白付编解码开销，还会**丢掉 tsc 的类型检查**——而类型检查才是进程内解耦
   真正依赖的东西。"禁止耦合"靠的是边界规则，不是序列化。
2. **跨进程没有带宽压力**：10Hz tick、≤24 个角色，JSON 的代价测不出来；而 devtools 里能直接读。
3. protobuf 要多一套 `.proto` + codegen + 产物入库，而本仓库对"新增文件进 profile"本来就有坑。

**但把接缝留好了**：业务代码只调 `codec.encode/decode`，从不碰 JSON。换 protobuf = 改 `wire/codec.ts` 一个文件。
**换的判据也写下来了**（不是拍脑袋）：单条消息常态 >64KB、事件频率 >100Hz、或出现非 JS 客户端。

### 做了什么

1. **边界检查器（本轮最有价值的东西）**。规则写成**数据**（`src/protocol/boundaries.ts`），
   `test/boundaries.test.js` 去**读源码、解析每个文件的 import、逐条判定**，违规打印模块名 +
   违规的 import + 当初写下的理由。三条规定被真正钉住：
   - **`sim/` 不许 import `content/`** —— 模拟内核只认装配好的 `World`；
   - **`tools/` 只许 import `protocol/`**；
   - **`web/` 只许 import `protocol/`**。
2. **当场抓到一处真耦合**：`src/tools/world.ts` 写着 `import type { PluginState } from '../state.js'`。
   已改成只认 `WorldServicePort` 端口——现在塞一个手写的假端口就能给工具写单测。
3. **端口**：`WorldServicePort`（工具↔状态）、`ContentPort`（工具↔内容，实现在 `content/port.ts`）、
   `EventSinkPort`（sim↔外部，M2 接）。端口里**不许出现实现类型**——否则消费方又被迫认识具体实现，
   端口就退化成多余的间接层。
4. **线协议**：六种消息（hello/snapshot/events/command/ack/error）+ 六种命令 + JSON codec。
   版本是**单整数、严格相等**，且**不匹配在形状检查之前就拒绝**（否则用户会以为是数据坏了）。
5. **两条设计教训（都是本轮自己踩的）**：
   - **规则自相矛盾**：第一版禁止 `protocol` import 任何模块，结果 `wire/messages.ts` 连
     `World` 这个**类型**都 import 不了——而世界的形状本来就是契约一部分。
     于是规则加了 `mayImportTypes` 维度，检查器区分 `import` 与 `import type`（擦除，无运行时依赖）。
   - **契约层的类型必须自持**：`boundaries.ts` 一开始 import 了 `content/kinds.js` 的 `LibraryKind`
     ——契约层 import 业务模块，缝就没了。把 `LibraryKind` 上提到 `protocol/library-kinds.ts`，
     内容层反过来 import 它（content → protocol 是允许方向）。
6. **排版与词汇表上提到契约层**（`protocol/format.ts` / `format-text.ts`）：
   工具输出与 HUD 要用同一套文案与同一份中文标签。放在 domain 层则 web 够不着（web 只许 import protocol），
   复制两份则必然出现"工具说『进行中』、HUD 说『运行中』"这种最难发现的同义异形。
   世界模型现在只负责"数字是多少"。
7. `docs/PROTOCOL.md`：三层协议、边界表、端口设计两条规矩、加模块/加消息的步骤、常见错误表。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 70 / pass 70 / fail 0
```

49 → **70**（含 M1.5-4 的 `agent_world_content` 工具测试）。新增 21 个里最该看的是这几条：

- **检查器本身被检查**：先用 7 组**人造违规**验证它真的会红（`sim` 值 import `content`、
  `tools` import `state`、`domain` import `node:fs`…），再去检查真实代码。
  **一个"永远返回 0 违规"的检查器是有害的**——它给人虚假的安全感。
- **豁免只对那一个文件有效**：`content/load-files.ts` 用 `node:` 允许，`content/registry.ts` 用 `node:` 报错。
- **import 提取要分清类型与值**：多行 `import type {`、`export type { … } from`、
  副作用导入 `import '../panel.js'`、以及 `import typewriter from './z.js'`（不能把 `type` 当关键字切）。
- **协议层与内容层的库清单必须一一对应**（`LIBRARY_KINDS` vs `LIBRARY_SPECS`）——
  不一致的症状是"面板按协议层遍历，静默地少显示一栏"。
- **版本不匹配要在形状检查之前拒绝**：故意发一个"版本错且缺 world 字段"的 snapshot，
  断言报的是 `protocol-mismatch` 而不是 `bad-shape`（报错的种类会决定排查方向）。
- **每一条边界规则都指向真实存在或明确登记为 planned 的模块**，且 `rationale` 不能太短。
  加新目录却忘了登记规则 → 检查器会**直接跳过它**（`moduleOfPath` 返回 null），违规不会被发现。

一处实现被测试纠正的记录：`resolveImportTarget('./state.js', 'tools/world.ts')` 我原本断言是 `app`，
实现给的是 `tools`。**实现是对的**（`./state.js` 从 `tools/` 出发就是 `tools/state.js`；
指向组合根的是 `../state.js`）。改的是测试。

### 下一轮从哪继续

**M2-1：`src/sim/ready.ts` 的依赖求值**（唯一实现点：`blockedBy` 全 done ⇒ `pending → ready`）。
按这个顺序推进 M2：

1. `src/sim/ready.ts`（M2-1，先做它因为调度器依赖它）→ 立刻加测试。
2. `src/sim/step.ts`（M2-3）严格按六段顺序：`ingest → scheduler → movement → interaction → mailbox → emit`。
   命令类型**已经有了**（`protocol/wire/commands.ts`，M2-2 已完成，别再造一份）。
   emit 段往 `EventSinkPort`（`protocol/ports/events.ts`）里丢，**不许直接调 runtime** —— 那会把
   模拟内核焊死在"一定有个 HTTP 服务器"上，而它的一半价值恰恰是可以 headless 跑。
3. 然后 scheduler / movement / mailbox（M2-4/5/6），每个模块写完立刻加测试。
4. M2-8 收口：`test/determinism.test.js` 同 seed 跑 1000 tick 两次逐字节一致。
5. `src/sim/` 是**新模块**：动手前先确认 `boundaries.ts` 里已有它的规则（已有），
   并且它只许 import `protocol` 与 `domain`——**不许** import `content`/`world`/`store`/`runtime`。

### 假设

- **协议只有我们自己两端**，所以版本策略取严格的单整数相等，不做向后兼容层。
  出现第三方客户端时这条要重新评估（见 PROTOCOL.md §4.2）。
- **`web/` 还没建**，所以"web 只许 import protocol"那条测试目前是空转（目录不存在就跳过）。
  它会在 M4 建 `web/` 的那一刻开始生效——**这是刻意的**：规则先生效于未来，而不是等违规出现再补。
- 端口方法的判据是"能被手写假实现满足"。做不到就说明这个方法切错了位置。

### 卡住 / 风险

- **边界检查器有一个已知盲区**：`moduleOfPath` 返回 null 的目录会被**静默跳过**。
  也就是说"新建一个模块目录但忘了在规则表登记"不会被发现。已有测试检查"规则表里的模块都真实存在"，
  但**反方向没有检查**（真实存在的目录都在规则表里）。已排成 M1.6-8。
- **路径安全边界仍未处理**（R2 就记过，R4 仍未动）：`ModelEntry.source.url` 可以是任意字符串。
  M4 真正加载 GLB 之前必须限制成包内相对路径并禁 `http://` 与 `../`。已排成 M1.6-7。
- 线协议的**编解码器只有 JSON 实现**，protobuf 只是"接缝留好了"，不是"已经能用"。
  别把 PROTOCOL.md §4.4 读成"我们支持 protobuf"——它说的是"换起来是改一个文件"。

### 本轮产出

- 新增：`src/protocol/`（`version` `boundaries` `library-kinds` `format` `format-text`
  `ports/{content,events,world-service}` `wire/{commands,messages,codec}` `index`）、
  `src/content/port.ts`、`test/boundaries.test.js`、`test/protocol.test.js`、`docs/PROTOCOL.md`
- 重构：`src/tools/world.ts`（只认端口 + 新增 `agent_world_content` 工具）、`src/state.ts`
  （实现 `WorldServicePort`）、`src/domain/summary.ts`（只留取数，排版搬走）、
  `src/content/{kinds,validate}.ts`（契约类型上提）
- 测试从 49 → 70；顺带补完 M1.5-4（`agent_world_content` 工具）

---

## R3 — 2026-10-14 · 外部内容包：用户改内容就能改世界

**本轮目标**（M1.5-1/2/3/5）：让"内容可替换"从"改源码里的包"变成"往目录里放 JSON"。
这是 R2 那套机制的第一次真实兑现——**不写一行代码，换掉花名册**。

### 做了什么

1. **`src/content/load-files.ts`** —— 对**目录**的纯函数（不决定目录在哪，那由调用方定，
   这样测试能直接喂临时目录）：
   - `<rootDir>/<packId>/pack.json` 是清单，`<kind>.json` 是各库条目数组（缺文件 = 不提供该库，不是错误）。
   - 允许单对象写法（`scene.json` 只有一条时少写一层方括号）。
   - `scenes` 同时接受单数 `scene.json`。
   - 子目录没有 `pack.json` → 跳过 + 警告（报的是**哪个目录**）。
   - **有一个错就整包跳过**，不加载半成品，并明确说"已整体跳过"。
2. **`resolveContentRoot(contentDir, cwd)`** —— 路径解析策略**明确、不猜**：
   空 → 不用外部内容；绝对路径 → 原样；相对路径 → 相对 `process.cwd()`。
   最终解析出的绝对路径 + 理由会**原样打进日志**。
3. **报错定位到文件（M1.5-3）** —— 校验器给的 `where` 是按库分的（`stations/station.x.kind`），
   它不知道文件叫什么。所以按 `where` 首段反查该库实际用的文件名，统一前缀成
   `my-town/stations.json: stations/station.x.kind`。**定位到条目 id 而不是数组下标**——
   手写 JSON 里搜 id 比数第几个元素快得多。
4. **不认识的 `.json` 文件名一律警告并列出可用名**。`station.json`（单数）这种手滑，
   症状是"站点一个都没有"而报错什么都不说——那种问题能耗掉一小时。
5. **接进 `state.ts` + `index.ts`（M1.5-2）**：内置包在前、外部包在后（于是外部排到提供方链首），
   但**链首 ≠ 可以乱覆盖**：没声明 `overrides` 的撞 id 仍是错误。`allowImplicitOverride` 接上配置。
6. **`content/index.ts` 刻意不导出 `load-files.ts`**：它 import 了 `node:fs`，而 `content/index`
   是给浏览器侧 `web/` 也能 import 的入口，混进去 Vite 打包会当场炸。这条写进了文件头注释。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 49 / pass 49 / fail 0
```

32 → **49** 个测试。新增 17 个全部围绕外部内容，含 3 条**走完整插件入口的端到端**：

- **改内容就改世界**：临时目录放一个 `my-team` 包，显式覆盖 `rosters/roster.software-team`，
  于是 `createWorld` 出来的是 2 个人（"队长本人" + "唯一的工程师"）而不是默认的 8 个；
  `world.origin.packs` 记着 `['pack.default', 'pack.my-team']`。**没改一行代码。**
- **偷偷换掉会被拦**：同样的包，去掉 `overrides` → 装载报错，且世界退回内置的 8 人、名字仍是"工头阿金"。
- **走 `apply()` 的完整链路**：`apply(ctx, { contentDir: <绝对路径> })` → 工具读到的世界就是外部内容装出来的；
  日志里能原样看到"实际读取的外部内容目录：/tmp/..."。
- 目录不存在 → **只警告不报错**，插件照常可用，世界退回内置内容（不能因为用户还没建目录就崩）。

一个测试写窄了被实现纠正的记录：我原本断言报错要含 `stations[0]`（数组下标），
实现给的是 `stations/station.x.kind`（条目 id）。**实现是对的**——手写 JSON 里搜 id 比数下标有用得多，
改的是测试。

### 下一轮从哪继续

**M1.5-4：`agent_world_content` 工具**（`src/tools/content.ts`）。具体：

1. 用 `state.content` 列：已装载的包（`content.packIds` 与各包的 version）、每个库的条目数与条目 id。
2. 支持按 id 查**提供方链**（`content.providersOf(kind, id)`）——这是排查"为什么我的覆盖没生效"的入口。
3. 输出要能回答三个问题，这也是它的验收标准：
   · 到底装了哪些包？· 某个 id 现在生效的是哪个包提供的？· 外部目录是哪个、有没有被跳过？
4. 顺带把 `state.contentIssues` 全量列出（现在只有前 5 条进日志，工具里应当给全部）。
5. **注意**：它只读，不许写盘、不许联网，工具描述里要写明。

做完 M1.5-4 就可以进 **M2 模拟内核**（`src/sim/ready.ts` 起步）——那是整个项目技术上最硬的一块。
M1.5-6（相对路径的解析基准）建议**先别做**：`workspaceRegistry` 没有"当前 workspace"的概念，
需要先查清 session→workspace 的绑定从哪拿，否则就是猜；宁可先让它显式要绝对路径。

### 假设

- **相对 `contentDir` 按 `process.cwd()` 解析**（宿主进程的工作目录，通常就是 workspace）。
  没去猜"当前 session 的 workspace"：`workspaceRegistry` 只提供 `list()` 与 `resolveByPath()`，
  多工作区时任何自动挑选都是猜，而猜错的症状是"读到了另一个项目的包"，比"没读到"难查得多。
  需要精确指向就写绝对路径。这条作为 M1.5-6 排进队列。
- 一个目录 = 一个包；不支持一个目录放多个包。
- 库文件名固定为 `<kind>.json`（`scenes` 兼容单数）。**拼错会被警告而不是静默忽略**。

### 卡住 / 风险

- **JSON 里的路径仍然没有安全边界**：`ModelEntry.source.url` 现在可以是任意字符串。
  等 M4/M5 真的开始加载 GLB 时，必须限制成**包内相对路径**并禁 `http://` 与 `../`。
  这条在 R2 就记过一次，**本轮仍未处理**——因为还没有消费者，现在定规则是空谈；
  但 M4-8（资源台账）之前必须落地，否则就是一个"内容包能指向任意 URL"的口子。
- 外部内容的**热重载**没有：改了 JSON 要重开世界才生效（`content` 在 `apply` 时装载一次）。
  是否要 watch 到 M3-2（runtime）再定，现在不做。
- M1.5-6 的调研成本未知，已单独拆成一条任务，避免它把别的事堵住。

### 本轮产出

- 新增：`src/content/load-files.ts`、`test/external-pack.test.js`
- 修改：`src/state.ts`（接受 `externalRoot`）、`src/index.ts`（解析并记录内容目录）、
  `docs/BACKLOG.md`、`docs/CONTENT.md`、`README.md`
- 测试从 32 → 49

---

## R2 — 2026-10-14 · 内容库层：机制与内容分离

**本轮目标**（用户反馈驱动）："应该按照一个游戏的模式设计，模型库、动作库、任务库、场景库等等都要整理好解耦好，方便替换升级和切换。"

R1 的架构里"内容"和"代码"是**混着**的——地段坐标、站点布局、配色全硬编码在 `src/domain/constants.ts` 里。
本轮把这层拆出来，并把"方便替换"从一句愿望变成**有强制力的机制**。

### 做了什么

1. **十个内容库**（`src/content/kinds.ts`）分两层：
   - **语义库**（host 权威）：`districts` 地块 / `stations` 站点 / `scenes` 场景 / `rosters` 角色 / `tasks` 任务
   - **表现库**（web 权威）：`models` 模型 / `actions` 动作 / `skins` 皮肤 / `sounds` 音效 / `themes` 主题
   两层共享同一套 id 契约与同一个注册表实现（决策 D13）——拆成两套机制就会开始漂移。

2. **"方便替换"的机制化**（这是本轮真正的产出，也是三条新决策）：
   - **稳定 id**：代码引用 `action.walk`，永远不引用 `walk.fbx`（D10）。
   - **提供方链 + 回退**：同一个 id 可被多个包提供，链首生效，其余留作回退；
     `resolve(kind, id, prefer)` 只**排序**不裁剪，所以"优先"永不导致条目丢失（D12）。
   - **覆盖必须显式**：撞 id 但没在清单 `overrides` 里声明 → 报错，且**原条目保持不变**（D11）。
     理由："悄悄换掉内容"是最难查的一类问题——世界看起来一切正常，只是某个站点变成了别的东西。

3. **校验器**（`src/content/validate.ts` + `registry.validate()`）：抓的是 **tsc 抓不到、
   运行时又难定位**的错误。单包查条目形状/枚举/依赖环/lead 数量；跨包查引用完整性
   （站点→地块、场景→站点/花名册/主题、配色→皮肤 token）与**动作覆盖度**
   （某个 `AgentState` 没动作 ⇒ 角色会僵在上一帧）。报错文案一律给"可用取值有哪些"（D15）。

4. **内置内容包** `pack.default`（`src/content/packs/default.ts`）：4 地块 / 10 站点 /
   8 人花名册 / 2 条工作流（`task.software-feature` 7 步 DAG、`task.quick-fix` 3 步）/
   皮肤（10 色调色板 + 职业色 + 站点色）/ 7 个动作 / 1 个主题。**表现层全是程序化几何**，
   所以现在零外部资产、零许可风险、零加载时间。

5. **重构分层**（决策 D10 的落地）：
   ```
   domain/   世界模型（类型、数值调参、几何、摘要、随机源）——不认识"内容"
      ↑
   content/  类型、校验、注册表、内置包、实例化
      ↑
   world/    createWorld（内容 → World）
   ```
   - `src/domain/create.ts` 删除，拆成 `src/content/instantiate.ts`（内容 → 对象，两层之间**唯一**的翻译层）
     + `src/world/create.ts`（装配）。
   - `src/domain/constants.ts` 只剩**数值调参**；`DEFAULT_DISTRICTS` / `DEFAULT_STATIONS` /
     `AGENT_PALETTE` / `ROLE_COLOR` 全部搬到内容包。
   - `Task` 新增 `key` / `set` / `estimateTicks`；`World` 新增 `origin`（场景 + 内容包 + 任务集），
     没有它就没法"用同样的内容重开一局"。

6. **`docs/CONTENT.md`**：十个库规范、包的写法、**三种操作**（新增内容 / 替换升级 / 切换提供方）、
   校验规则表、命名规范、一个完整的 Kenney 替换示例、常见错误对照表。

7. `src/index.ts` 加了内容问题的**软失败**：内容有 error 时不让它拖垮插件加载
   （插件树加载失败会让整个 dsh 起不来，代价远大于"世界暂时建不出来"），
   改为打日志 + `agent_world_status` 里列出细节。照 dsh-daily 的既有做法。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 32 / pass 32 / fail 0
```

从 10 个测试涨到 **32 个**。新增的 22 个里，**18 个专门钉住内容层机制**，每条都对应一个真实会踩的坑：

- 撞 id 没声明 overrides → 报错**且原条目不变**；声明了就生效**且旧提供方留在链上可回退**
- `resolve(prefer)` 只排序不裁剪（prefer 里写个不相干的包，条目不能丢）
- `allowImplicitOverride` 打开时只警告
- 站点引用不存在的地块 / 场景引用不存在的站点 / 皮肤 token 不存在 → 都在加载时报错
- **某个 AgentState 没有动作 → 报错**（这条最值钱：换动作库时漏一个状态，会在测试里红，而不是在画面上看到角色僵住）
- 任务依赖成环 → 报错并打印完整环路；依赖指向集合外 → 报错并列出可用 key
- `schemaVersion` 不匹配 → 明确拒绝；包依赖缺失/成环 → 报错
- 拓扑序：故意把依赖方放在前面传入，装载顺序仍正确
- `relativeTo` 坐标解析正确（**所有站点都必须落在小镇范围内**——坐标解析错了最典型的症状就是跑到地图外）
- 连派两个任务集，跨集合 id 不撞且依赖不串

### 下一轮从哪继续

**M1.5-1：外部内容包加载器**（`src/content/load-files.ts`）。具体：

1. 读 `<workspace>/<contentDir>/<packId>/` 下的 `pack.json` + 各库 `.json`（缺哪个文件 = 不提供那个库，不是错误）。
2. **错误信息里必须带文件路径**（M1.5-3）——否则用户不知道去哪个文件改。这是外部内容与内置内容最大的体验差别。
3. 接进 `src/state.ts`：内置包 + 外部包一起 `loadAll`，`allowImplicitOverride` 接上配置（配置项已就位）。
4. M1.5-5 是验收：临时 workspace 里放一个外部包顶掉小镇布局，`createWorld` 出来的世界确实变了。

之后就是 M2 模拟内核（`src/sim/ready.ts` 起步），那是整个项目技术上最硬的一块。

### 假设

- **内置内容编译进代码、外部内容走文件系统**（决策 D14）。这是被本仓库的硬链接副本坑逼出来的：
  `file:` 依赖装进 profile 时新增文件**不会**被同步（`docs/DEVELOPMENT.md` §7），
  而插件树加载失败会让整个 dsh 起不来。所以内置走 TS 常量（不新增文件），外部走文件系统（用户自己放的）。
- **包是替换与升级的单位**，不支持"只覆盖一条而不整包"（BACKLOG 待决问题 5）。想要细粒度就新建一个包。
- 表现库在 host 侧可能完全不存在（面板没打开、只跑 headless），所以跨包校验里
  "场景引用的主题""皮肤 token"这类检查**只在对应库非空时才跑**。

### 卡住 / 风险

- **M5 是这个设计唯一的真实验证点**：到目前为止"换一套角色只改模型库+动作库"还是**推理**，
  没被跑过。到 M5-6 必须拿出证据：加了 `pack.kenney-mini` 之后 `pnpm test` 仍全绿、模拟内核零改动。
  在那之前不要把这条当成已验证的事实。
- 外部内容包的**安全边界**没定义：JSON 里将来若出现 `url` 字段（模型/音效），
  要不要限制只能读包内相对路径、禁 `http://` 与 `../`？→ 留到 M1.5-1 一并处理，倾向于**默认禁网络**。
- 注册表的提供方链目前**没有持久化**：世界落盘（M3-1）时只存 `origin.packs`，
  恢复时靠"用同样的包按同样顺序装载"重建链。如果用户换了包集合，旧存档的渲染表现会变——
  这是可接受的（内容升级本来就该改变表现），但要在 M3-1 里把 `origin.packs` 的版本一并存下来，
  好让"这局是用哪个版本的内容玩的"可查。

### 本轮产出

- 新增：`src/content/{kinds,validate,registry,instantiate,index}.ts`、`src/content/packs/default.ts`、
  `src/world/create.ts`、`test/content.test.js`、`docs/CONTENT.md`
- 删除：`src/domain/create.ts`（拆成上面两个）
- 重写：`src/domain/constants.ts`（只剩数值）、`src/domain/index.ts`、`src/state.ts`、
  `src/tools/world.ts`、`src/index.ts`、`src/config.ts`、`test/smoke.test.js`
- 文档：`ARCHITECTURE.md`（§2.1/§2.2 新增、§3 实体表、§9 里程碑重排、§10 目录、§12 加 D10–D15）、
  `BACKLOG.md`（全量重排）、`README.md`

---

## R1 — 2026-10-14 · 立项、选型、骨架、世界模型

**本轮目标**：把项目立起来，并把「架构」这块最难的地方先定死（用户点名说架构是难点）。

### 做了什么

1. **勘察底座**：定位到参考实现 `@nanmicoder/dsh-agent-teams@0.1.23`
   （装在 `~/.dsh/profiles/web/node_modules/@nanmicoder/dsh-agent-teams`）。读出了它的骨架：
   - host 侧一层：`index.js`（注册 `agent_teams_*` 工具 + 系统提示词段落）、`state.js` / `members.js` /
     `scheduler.js` / `mailbox.js` / `tools.js`、`cordis.patch.yml`（bundle patch）。
   - 磁盘真相：`<workspace>/.agent-teams/<teamId>/`（`team.json` + `inbox/*.jsonl`）。
   - client 侧一层：`lib/client.js`，React，注入 DSH 的 slot。
   **本项目的「底座」= 这套语义（lead + durable members + 依赖感知任务 + 邮箱 + 调度器），
   不是它的代码。** 我们重写 host 侧，并把呈现层从 React 面板换成 3D 场景。

2. **技术选型（决策 D1）**：**three.js**，不用 Godot。完整对比在
   `docs/ARCHITECTURE.md` §1。一句话：Godot 要 wasm + JS interop + 编辑器流水线，
   three.js 直接就是同浏览器里的一个页面。Godot 被**推迟**（不是否决）——
   因为 §2 把渲染层做成了哑客户端，将来换引擎不用动业务。

3. **架构定稿**：`docs/ARCHITECTURE.md`（12 节 + 6 条决策记录）。核心是三条：
   - **server-authoritative**：模拟跑在 host，渲染层只画状态、只发意图；
   - **`tick` 是纯函数 + seeded PRNG**：确定性 ⇒ 可回放 bug、可无 mock 测试；
   - **capability 落位**：任务只声明"需要什么能力"，不硬绑工位 ⇒ 布局与编排解耦。

4. **代码骨架 + 世界模型（M0-1…M0-3, M1-1…M1-3）**：
   ```
   src/config.ts              schemastery 配置 + resolveConfig 兜底
   src/state.ts               插件态：内存世界 + ensureWorld/resetWorld
   src/index.ts               入口：name/inject/apply
   src/tools/world.ts         agent_world_status（只读）+ agent_world_open（写）
   src/domain/types.ts        世界模型全部类型 + 两个状态机
   src/domain/constants.ts    默认小镇布局（4 地段 / 10 站点）+ 配色 + 调参
   src/domain/rng.ts          mulberry32 seeded PRNG
   src/domain/create.ts       createWorld()（纯函数）
   src/domain/geometry.ts     距离/转向/到站 slot 吸附
   src/domain/summary.ts      世界摘要 + 花名册 + 工单板文本（三处共用同一口径）
   src/domain/index.ts        领域层出口（web/ 以后直接 import 这份，不复制）
   test/smoke.test.js         10 个测试
   ```

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test
# → tests 10 / pass 10 / fail 0
```

测试覆盖：导出契约（`name`/`inject`/`apply`）、**`apply(ctx, undefined)` 不崩**
（Loader 在 patch 没写 config 时就是给 undefined，schema default 不会自动填——本仓库最容易崩的一条路径）、
`createWorld` 同 seed 逐字段一致 / 不同 seed 分叉、小镇结构完整性（每个站点的 district 与 slot 都存在）、
`maxAgents` 硬上限、`summarize` 口径与数组真实内容一致、PRNG 序列可复现且不退化。

### 下一轮从哪继续

**M1-4：`src/sim/step.ts` 的纯函数 tick。** 具体：

1. 先写 `src/sim/ready.ts`（M1-5，先做它因为调度器依赖它）：唯一实现点是
   「所有 `blockedBy` 的 task 都 `done` ⇒ `pending` 变 `ready`」。
2. 再写 `src/domain/commands.ts`：命令类型联合（`pause` / `resume` / `reset` / `dispatch` / `hire`），
   这是 `step()` 的第三个参数。
3. 然后 `src/sim/step.ts`，严格按 §4.1 的六段顺序：
   `ingest → scheduler → movement → interaction → mailbox → emit`。
   注意：**模拟层禁止 `Math.random()` / `Date.now()`**，随机一律走传入的 `Rng`。
4. 每写一个 sim 模块，立刻在 `test/` 加一个测试。M1-9 是收口：
   `test/determinism.test.js` 跑 1000 tick，两次结果逐字节一致。

### 假设（没问人，按最合理的定了）

- 一个 workspace 一个活跃世界 + 历史归档（BACKLOG 待决问题 2）。
- 角色数上限默认 24（`MAX_AGENTS`），M4 实测后再调。
- 小镇是 16×16 单位、原点在中心、四象限四地段（`TOWN_HALF = 8`）。
- 面板用宿主 HTTP 路由吐出的**独立页面**，不塞进宿主 client bundle（决策 D3）。
  理由：避免与宿主 React/three 版本冲突，且 Vite HMR 迭代快。

### 卡住 / 风险

1. **根 workspace 的 `pnpm install` 是坏的**（不是本包引起的）：
   `packages/dsh-daily` 声明了 `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-invariants` /
   `@deepseek-ai/dsh-session` 的 `>=0.1.2 <0.2.0-0` 范围，而公共 registry 上这些包只有
   `0.0.1-rc.1`（latest）/ `next: 0.2.0-rc.2` / `alpha: …`，范围内无匹配；
   根 `pnpm-lock.yaml` 停在 2026-09-22 的旧解析结果（有 3000+ 行未提交改动，**不是本轮改的**，
   mtime 未变）。`pnpm-lock.yaml` 本轮**没有被我修改**，也没提交。
   → 本包因此独立安装并关掉 run 前校验（见上方环境备忘）。**没有去修它**：
   那属于 dsh-daily 的依赖维护，且用户当时在 `feat/dsh-daily` 分支上有未提交改动，不该我碰。
2. `docs/ARCHITECTURE.md` §5.4 的美术方向目前是**设计**，还没有任何真实资产。
   资产落地在 M3-5 / M7-3，届时必须有 `web/public/assets/VENDOR.md`（URL + 许可 + sha256）。
3. 面板入口位置（右侧栏常驻 vs 新 view tab）与音效是否要做，都留到 M5 再决（BACKLOG 待决问题）。

### 补充（同日）：资产 / 库调研已落地成文档

派了一个后台调研去把 M3/M7 的美术与依赖问题一次问清（一手来源核验，含真的把资产 zip 与 GLB
拉下来解析），结果收到后**没有让它烂在对话里**，全部折进了文档：

- 新增 [`docs/ASSETS.md`](ASSETS.md)：推荐的 CC0 资产包（含实测体积）、角色动画三方案对比、
  three.js 生态库版本与许可、10 条许可红线、`VENDOR.md` 台账模板、美术配方（相机/光照/调色板/性能预算）。
- `ARCHITECTURE.md`：§5.3 性能预算按调研**收紧**（300k 面 → ≤100k，150 draw call → ≤60，
  新增贴图 ≤512² 与首屏载荷 ≤5 MB）；§5.4 重写成具体配方并指向 ASSETS.md；
  §11 补两条风险（资产许可、peer 上限）；§12 新增 **D7/D8/D9** 三条决策。
- `BACKLOG.md`：M3-1/M3-3/M3-5/M4-2/M7-3 全部改成**可执行的具体项**（原本只是"落地美术方向"这种空话）。

三条本轮新定的决策（都已进 §12）：

- **D7 面板用纯 three.js，不引 `@react-three/fiber`**：R3F 系库全部只支持 React 19，
  引它等于把面板绑死在某个 React 大版本上；而 §5.2 的分层本来就是「model 出插值状态 →
  scene 每帧命令式同步」，React 的 diff 在这层不是价值而是开销。HUD 也走原生 DOM。
- **D8 角色用 Kenney Mini Characters**：单角色 247 kB vs KayKit 3.5 MB，我们 ≤24 个同屏差 14 倍。
- **D9 只有 CC0/public domain 的字节可以进 git**：禁 Mixamo 派生文件、CC-BY 资产、Sketchfab、
  Quaternius。**这条最值得记住**：Mixamo 的 Adobe FAQ 只授权"在项目里使用"，**没授权再分发
  剪辑文件本身**（而且中国区和 Enterprise/Federated 账号根本用不了，外部贡献者无法复现）；
  Quaternius 2026-08-28 起换成 QAL v1.0，§3(a) 禁止再分发资产本身，**但各包页面仍挂着 CC0 徽章**——
  这是个真陷阱。官方条款页在本机被 IP 拦（403），Mixamo 再分发问题**仍标注为未核验**，
  已写进 ASSETS.md §7 待复核。

### 本轮产出

- 分支：`feat/dsh-agent-world`（从 `feat/dsh-daily` 的 HEAD 切出；**没有**动那个分支上的未提交改动）
- 新增包：`packages/dsh-agent-world/`
- 文档：`docs/ARCHITECTURE.md`、`docs/BACKLOG.md`、本文件、`README.md`
