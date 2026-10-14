# dsh-agent-world —— 内容库规范

> 这份文档回答一个问题：**"想换个模型 / 换套动作 / 加一条工作流 / 换一座小镇"时，我该动哪里？**
>
> 答案一律是"动内容，不动代码"。本文说明内容库有哪些、条目长什么样、
> 怎么新增、怎么替换、怎么切换，以及写错了会在哪里红。

---

## 1. 核心原则：机制是代码，内容是数据

| | 代码（机制） | 内容（数据） |
|---|---|---|
| 例子 | "角色走路要向目标移动"；"工单要等前置完成" | "走路播哪个剪辑"；"这条流水线有哪几张工单" |
| 落位 | `src/domain/` `src/content/registry.ts` `src/world/` `web/src/` | `src/content/packs/`（内置）· `<workspace>/.agent-world/content/`（外部） |
| 换它要做什么 | 改代码、跑测试 | 换一个内容包，**代码一行不动** |

**硬规矩（决策 D10）：代码里禁止出现字面量的资产名、剪辑名、任务文案、配色值。**
一旦你在 `.ts` 里看到 `'walk.fbx'` 或 `'#6F7D5A'` 或 `'实现核心逻辑'`，那就是漏了一层。

判据很简单：**问自己"这个东西会不会有人想换掉？"** 会 → 它是内容。

---

## 2. 十个库一览

### 语义库（semantic）—— 模拟需要知道的，权威在 host

| 库 | id 前缀 | 一个条目是什么 | 谁会消费 |
|---|---|---|---|
| `districts` 地块库 | `district.` | 一块地：种类、矩形范围、地面色 token | host（边界）· web（地面网格） |
| `stations` 站点库 | `station.` | 一个工位/设施：能力、容量、位置 | host（任务落位、寻路目标）· web（几何） |
| `scenes` 场景库 | `scene.` | **一局小镇的装配单**：引用哪些地块与站点、入场点、用哪个主题与花名册 | host（建世界）· web（布局） |
| `rosters` 角色库 | `roster.` | 一队角色：职业、名字、配色、默认模型路由 | host（招募）· web（外观） |
| `tasks` 任务库 | `task.` | **一条工作流**：一组带依赖的工单模板 | host（派单） |

### 表现库（presentation）—— 只有渲染需要知道的，权威在 web

| 库 | id 前缀 | 一个条目是什么 | 谁会消费 |
|---|---|---|---|
| `models` 模型库 | `model.` | 3D 资产：glTF 文件**或**程序化几何构建器，含缩放/朝向/贴地修正 | web |
| `actions` 动作库 | `action.` | **`AgentState` → 动画剪辑的映射**（见 §3，这是解耦的关键一跳） | web |
| `skins` 皮肤库 | `skin.` | 一堆命名色 token（地块地面、职业色、站点色、强调色） | web（host 只透传） |
| `sounds` 音效库 | `sound.` | 世界事件 → 音效 | web |
| `themes` 主题库 | `theme.` | 相机 / 光照 / 雾 / 后处理的预设 | web |

> 加一个新库：在 `src/content/kinds.ts` 的 `LibraryKind` 与 `LIBRARY_SPECS` 里各加一行，
> 在 `LibraryEntryMap` 里补类型，在 `validate.ts` 的 `validateEntryShape` 里补一个 case。
> 四处缺一处，校验器就会漏掉那一类错误。

---

## 3. 解耦的关键一跳：动作库

这是**整个内容层最有价值的设计**，值得单独讲。

模拟层从头到尾只会说一句话：`AgentState = 'walking'`。
它不知道、也不允许知道"走路"在世界里长什么样。这个映射在动作库里：

```jsonc
{ "id": "action.walk", "state": "walking", "clip": null, "loop": true, "speedScale": 1, "fadeMs": 150 }
```

* `clip: null` → 渲染层用**程序化动画**（起伏 / 挤压 / 倾斜）。零资产、零许可风险。
* `clip: "walk"` → 渲染层去角色 GLB 里播名叫 `walk` 的剪辑。

于是**换一套角色包只改模型库 + 动作库**：

| | 内置（程序化） | 换成 Kenney Mini Characters |
|---|---|---|
| `models` | `model.agent.base` → `{ kind: 'procedural', builder: 'avatar' }` | `{ kind: 'glb', url: '/assets/kenney-mini/character-male-a.glb' }` |
| `actions` | 全部 `clip: null` | `action.walk` → `clip: 'walk'`；`action.work` → `clip: 'sit'` … |
| 模拟内核 | — | **一行都不用改** |

所有 `AgentState` 都**必须**有动作，否则角色进入那个状态会僵在上一帧。
注册表的 `validate()` 会把缺的状态逐个报出来（见 §6）。

---

## 4. 内容包（pack）

**包是替换与升级的单位。** 切换/升级永远以整包为粒度，而不是"改某一条"。

### 4.1 清单

```jsonc
{
  "id": "pack.default",              // 全局唯一
  "name": "默认小镇",
  "version": "1.0.0",                // semver，改内容就要 bump
  "schemaVersion": 1,                // 清单格式版本；不匹配会被明确拒绝，不会猜着加载
  "description": "……",
  "requires": [],                    // 依赖的其它包（按拓扑序装载）
  "provides": ["districts", "stations", "…"],  // 本包填充哪些库
  "overrides": ["actions/action.walk"]         // 显式声明要覆盖的 kind/id
}
```

### 4.2 内置 vs 外部（决策 D14）

| | 内置内容包 | 外部内容包 |
|---|---|---|
| 落位 | `src/content/packs/*.ts` | `<workspace>/.agent-world/content/<packId>/` |
| 形态 | TS 常量，**编译进 `lib/`** | 目录 + `pack.json` + 各库的 `.json` |
| 现状 | 已有 `pack.default` | **未实现（BACKLOG M1-6）** |

**为什么内置内容必须编译进代码而不是随包发 JSON**：本仓库有一条很坑的约定
（`docs/DEVELOPMENT.md` §7）——`file:` 依赖装进 profile 时是**硬链接副本**，已存在的文件会被原地重写
（inode 相同）所以能同步，但**新增文件是全新 inode，没有任何环节会把它链进 profile**。
症状是"源码里明明有这个文件，运行时却说找不到"，而 dsh 是插件树加载失败就**整体不启动**。

所以内置内容是 TS 常量（不产生新文件），外部内容走文件系统（用户自己放的，不受副本影响）。

### 4.3 外部包的计划形态

```
<workspace>/.agent-world/content/my-town/
├── pack.json           ← manifest
├── districts.json
├── stations.json
├── scene.json
├── roster.json
├── tasks.json
├── models.json
├── actions.json
├── skins.json
└── themes.json
```

每个文件是该库的条目数组。缺哪个文件就是"这个包不提供那个库"，不是错误。

---

## 5. 三种操作

### 5.1 新增内容（最常见）

**加一条工作流**：在 `tasks` 库里加一个条目（或反过来，在外部包里新建一个 `.json`）。

```ts
{
  id: 'task.doc-audit',
  name: '文档审计',
  description: '对着实现逐条核对文档。',
  tasks: [
    { key: 'scan',   title: '扫描文档与实现的差异', description: '', requires: ['research'],
      dependsOn: [],        acceptance: '列出所有过期描述', estimateTicks: 600,  role: 'docs' },
    { key: 'fix-doc', title: '修正文档',            description: '', requires: ['code'],
      dependsOn: ['scan'],  acceptance: '文档与实现一致',   estimateTicks: 900,  role: 'docs' },
  ],
}
```

派单时用 `task.doc-audit` 即可。模拟内核、渲染层都不需要知道它的存在。

### 5.2 替换 / 升级（换一套资产）

**换角色模型（M5 要做的）**：新建 `pack.kenney-mini`，只提供 `models` 与 `actions`，
并在清单里**显式声明覆盖**：

```ts
manifest: {
  id: 'pack.kenney-mini',
  requires: [],                       // 它不依赖 pack.default，但会顶掉后者的条目
  provides: ['models', 'actions'],
  overrides: [
    'models/model.agent.base',
    'actions/action.idle', 'actions/action.walk', 'actions/action.work',
    'actions/action.talk', 'actions/action.blocked', 'actions/action.celebrate',
    'actions/action.sleep',
  ],
}
```

**覆盖必须显式。** 没写 `overrides` 就撞 id → 校验报错，且**原条目保持不变**。
理由："悄悄换掉别人的内容"是最难查的一类问题——世界看起来一切正常，
只是某个站点变成了别的东西。

### 5.3 切换提供方（同一 id 换回退顺序）

覆盖之后，同一个 id 会有**多个提供方**。它们按装载顺序排成一条链，
链首是当前生效项，其余留在链上：

```ts
registry.providersOf('actions', 'action.walk')
// → ['pack.kenney-mini', 'pack.default']

// 显式切回内置实现（比如 GLB 加载失败）：
registry.resolve('actions', 'action.walk', ['pack.default'])
// → [{ pack: 'pack.default', … }, { pack: 'pack.kenney-mini', … }]
```

`resolve` 的 `prefer` 只是**排序**，不是白名单：`prefer` 里没提到的提供方会跟在后面，
所以"优先"永远不会导致条目丢失。这条是刻意的——回退链的意义就在于**退得下去**。

---

## 6. 校验规则（会在哪里红）

校验分两段：`validatePack()` 查**单包自洽**，`registry.validate()` 查**跨包引用**。
两类错误都会在装载时暴露，不会拖到画面上。

### 单包（`validatePack`）

| 情况 | 级别 |
|---|---|
| `schemaVersion` 与当前不符 | error（明确拒绝，不猜） |
| 包 id/name/version 不是非空字符串 | error |
| 同一个包内 id 重复 | error |
| 条目形状不对（缺字段、枚举值非法、数字越界） | error |
| `provides` 声明了某个库但一条条目都没有 | warning |
| 有某库的条目但没在 `provides` 里声明 | warning |
| id 不符合该库的命名前缀约定 | warning（只提醒） |
| 任务集内部 `dependsOn` 指向集合外的 key | error（并列出可用 key） |
| 任务依赖成环 | error（会打印环上的完整路径） |
| 工单 `requires` 为空 | error（调度器不知道派去哪） |
| 花名册里 lead 不是恰好 1 个 | error（0 个没人派单，多个分不清谁是工头） |

### 跨包（`registry.validate`）

| 情况 | 级别 |
|---|---|
| 站点引用的地块不存在 | error（列出可用地块） |
| 场景引用的地块/站点/花名册不存在 | error |
| 场景引用的主题不存在 | error（**仅当装载了主题库时**——host 侧可能没有表现库） |
| 地块地面色 / 角色配色引用的皮肤 token 不存在 | error（仅当装载了皮肤库时） |
| 某个 `AgentState` 没有任何动作 | error（角色会僵在上一帧） |
| `sleeping` 没有动作 | warning（只是站着休息，不至于出错） |

> **报错文案是给内容作者看的**，所以每条都要能直接下手：说明哪个条目、哪个字段、
> 期望什么、**可用的取值有哪些**。写校验时请保持这个标准——"引用无效"这四个字帮不了任何人。

---

## 7. 命名与目录规范

| 对象 | 规范 | 例 |
|---|---|---|
| 包 id | `pack.<短名>` | `pack.default` · `pack.kenney-mini` |
| 条目 id | `<库单数前缀>.<短名>` | `station.desk-a` · `action.walk` · `task.quick-fix` |
| 任务集内的 key | 短横线小写、集合内唯一 | `impl-core` · `fix-doc` |
| 皮肤 token | 点分层级、无 `skin.` 前缀（引用时才加） | `ground.engineering` · `role.lead` |
| 外部包目录 | 目录名 = 包 id 去掉 `pack.` 后缀 | `my-town/` |

前缀约定只是 warning 级提醒，不是硬约束——**但请遵守**，否则在几千个条目里找一个站点会变成考古。

---

## 8. 一个完整的替换示例（M5 的验收标准）

目标：把程序化角色换成 Kenney Mini Characters（CC0，单角色 247 kB，每 GLB 内嵌 32 个动画剪辑）。

**第一步：资产入库**（按 `docs/ASSETS.md` §5 的台账规范）

```
web/public/assets/kenney-mini/
├── VENDOR.md          ← 来源 URL + CC0 + zip 内 License.txt + 下载日期 + sha256
├── License.txt        ← 许可原文，必须入库
└── character-male-a.glb   ← 247 kB
```

**第二步：新增内容包** `src/content/packs/kenney-mini.ts`（清单见 §5.2），条目：

```ts
models: [
  { id: 'model.agent.base', name: '角色（Kenney Mini）',
    source: { kind: 'glb', url: '/assets/kenney-mini/character-male-a.glb', clipSource: true },
    scale: 1, rotationY: Math.PI, anchorY: 0 },
],
actions: [
  { id: 'action.idle',      name: '待命', state: 'idle',        clip: 'idle',       loop: true,  speedScale: 1,   fadeMs: 200 },
  { id: 'action.walk',      name: '走路', state: 'walking',     clip: 'walk',       loop: true,  speedScale: 1,   fadeMs: 150 },
  { id: 'action.work',      name: '干活', state: 'working',     clip: 'sit',        loop: true,  speedScale: 1,   fadeMs: 200 },
  // … 其余状态同理，一个都不能少
],
```

**第三步：接进装载列表**

```ts
export function builtinPacks(): ContentPack[] {
  return [defaultPack, kenneyMiniPack]   // 后装的排到链首 = 生效
}
```

**验证**：`pnpm test` 必须仍然全绿——尤其那条「内置内容包：零 error、零 warning」。
如果覆盖漏了某个 `action.*`，注册表会报出「某个 AgentState 没有动作」，
你会在**测试里**发现，而不是在画面上看到角色僵住。

**模拟内核、HTTP 层、bridge 层一行都不用改。** 这就是这一层存在的全部意义。

---

## 9. 常见错误

| 症状 | 原因 | 怎么办 |
|---|---|---|
| 报「条目 id 与包 X 冲突」 | 撞了 id 但没声明 `overrides` | 要么改 id，要么在清单 `overrides` 里写 `kind/id` |
| 报「某个 AgentState 没有动作」 | 换动作库时漏了一个状态 | 补一条 `action` 条目，`clip` 可以是 `null` |
| 报「场景引用的站点不存在」 | 场景的 `stations` 数组里有拼错的 id | 报错里会列出可用 id，照着改 |
| 角色站在地图外面 | 站点写了 `relativeTo` 但坐标是按绝对值给的（或反过来） | `relativeTo` 非 null 时 `anchor` 是**偏移**，不是绝对坐标 |
| 报「任务依赖存在环」 | `dependsOn` 互相指 | 报错会打印完整环路，照着断一条 |
| 世界建不出来 | 内容有 error | 调 `agent_world_status` 看内容层的错误详情 |
| 改了内容包但没生效 | 包重复装载被忽略了 / 覆盖没声明 | 看装载时的 warning「已经装载过」 |
| 改了内容文件但 profile 里没变化 | 新增文件没被硬链接同步进 profile | 跑 `pnpm sync:web`（见 `docs/DEVELOPMENT.md` §7） |
