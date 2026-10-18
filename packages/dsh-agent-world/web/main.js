/*
 * 装配根（R32）—— `main.js` **只做装配**，不写业务。
 *
 * 它把四块东西接起来：
 *   1) `net/connection.js`：一次快照 + 一条 SSE 增量流；
 *   2) `scene/*`：渲染器（R66 起只有 Phaser 这一条：俯视格子）；
 *   3) `ui/*`：顶栏、抽屉（花名册/工单/对话）、图例、底部看板；
 *   4) `core/*`：纯逻辑（增量应用、对话状态机、看板布局）。
 *
 * 装配处唯一该有的东西是**接线与节流**：谁在什么时候调谁。
 * 任何"算"的逻辑都该在 `core/` 或对应模块里——那才测得动。
 *
 * ── 一帧里发生什么（渲染循环）────────────────────────────────────────────────
 *
 *   setInterval(250ms) ──► render()  ──► 画场景（Phaser）
 *                                      ├─ 花名册/工单/顶栏（都是文本，签名没变就不动 DOM）
 *                                      ├─ 头顶气泡（位置每帧算）
 *                                      └─ 对话面板（只重画变了的那些行）
 *
 * **刻意不用 `requestAnimationFrame`**：rAF 在**不可见的标签页里根本不触发**，
 * 而这个面板的典型场景恰恰是"agent 在跑、人不一定在看"——用 rAF 的话，
 * 面板在我们盯着它之前一直是空的（DOM 与画布都停在初始状态），
 * 而这会让"自动化核验"读到一份陈旧 DOM，看起来像面板坏了。
 * 时间戳节流在隐藏标签页里也照常工作（定时器会被降频，但不会完全不触发）。
 */

import { applyEvents, pruneMessages } from './core/world-update.js'
import { createSelfCheck } from './core/self-check.js'
import { dialogueEventsFromFrame } from './core/dialogue-state.js'
import { createConnection } from './net/connection.js'
// R58：2D 渲染器 = **Phaser**（唯一实现）。`?renderer=canvas` 映射到 `type: Phaser.CANVAS`；
// 缺省 `Phaser.AUTO` = WebGL 优先、**canvas 自动回退**（我们自己写的那套回退已删）。
// 接口与以前逐个同名同参，所以下面一行都不用改。
import { createScenePhaser, requestedRenderer } from './scene/scene-phaser.js'
import { createTopbar } from './ui/topbar.js'
import { createLegend } from './ui/legend.js'
import { createSidebar } from './ui/sidebar.js'
import { createBoard } from './ui/board.js'
import { createDialogueUi } from './ui/dialogue-ui.js'

const COMMAND_API = './api/command'
/** 发话端点（回复走 SSE 的 `dialogue` 帧，见 `src/protocol/dialogue.ts`）。 */
const SAY_API = './api/say'
/** 渲染节流：约 60fps。 */
const RENDER_MIN_GAP_MS = 16
/** "他在想…"最多挂多少步（宿主挂了的话 `failed` 永远不会来，面板要有自己的兜底）。 */
const DIALOGUE_SILENT_TICKS = 300

/**
 * 构建标记（R84）。**故意显示在性能条里**：它回答一个反复困扰我们的问题——
 * "你看的这页到底是不是我刚改的代码"。改完 `web/` 就把它 +1。
 */
const BUILD = 'build r103'

/** 上一帧各精灵的动画键（`trackAnimFlips` 用）。 */
let lastAnimKeys = null
/** 累计"某只精灵的动画键变了"的次数——朝向抖动会把它快速推高，稳定时它不动。 */
let animFlipCount = 0

/**
 * 统计"动画键发生变化的次数"（R84 诊断用）。
 *
 * 为什么放在外壳而不是渲染层：`scene-phaser.js` 正被另一个 Agent 频繁改写，
 * 每次改都会被并发冲突挡住；而这件事实质上只是**读一帧的显示列表**，属于外壳的事。
 *
 * @returns {number} 到目前为止累计的切换次数
 */
function trackAnimFlips() {
  const scene = globalThis.__agentWorldPhaser?.scene?.()
  const list = scene?.layers?.entities?.list
  if (Array.isArray(list) !== true) return animFlipCount
  const keys = []
  for (const object of list) {
    if (object?.type === 'Sprite' && object.visible !== false) keys.push(object.anims?.currentAnim?.key ?? '')
  }
  if (lastAnimKeys !== null && lastAnimKeys.length === keys.length) {
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i] !== lastAnimKeys[i]) animFlipCount += 1
    }
  }
  lastAnimKeys = keys
  return animFlipCount
}

const $ = (id) => document.getElementById(id)
const canvas = $('town')
const $hint = $('view-hint')

/** 本地世界（快照起家，之后靠增量维护）。 */
let world = null
/** 快照里的静态部分（场景描述、内容概况、主题、时钟参数、调色板）。 */
let meta = null
/** 上一次真正渲染的时刻（节流用）。 */
let lastRenderMs = -1
/** 看板里选中的任务（用来高亮抽屉里对应的那一行）。 */
let boardSelection = null
/**
 * 调度器诊断（R67 / M13-5）：`runtime.diagnostics`。
 *
 * 看板用它显示"调度器这一轮为什么不派某张单"（没人 / 没工位）。它是**快照字段**，
 * 只在 `onSnapshot` 里更新——事件流不带它。所以它是"最近一次调度"的读数，
 * 而不是累积历史（这一点要和看板里"前置失败=永远等不到"的结论区分开）。
 */
let diagnostics = null
/** 对话面板（状态机在 core/dialogue-state.js，DOM 在 ui/dialogue-ui.js）。 */
let dialogue = null
// ── UI 模块 ───────────────────────────────────────────────────────────────────

const topbar = createTopbar({
  root: $('topbar'),
  worldName: 'Agent World',
  onCommand: (kind) => void sendCommand(kind),
})

// R76：右侧抽屉（花名册/工单）已删——agent/任务列表只剩顶栏看板一份；气泡进引擎后也不再需要给抽屉让位。

const legend = createLegend({ root: $('legend') })

/**
 * 渲染自检（R7 / 计划 S1+S2）：**帧被重置 / 动画互抢 / 与服务端漂移**三个计数器。
 *
 * 逻辑全在 `core/self-check.js`（纯函数，node 里测过）；这里只做接线——
 * 因为它要读的两处读数（Phaser 的 `entities` 层、`scene2d.liveActors()`）
 * 都在这个装配层拿得到，而渲染层正被另一个 Agent 频繁改写。
 *
 * 为什么要它：R85 的真凶（每帧 `setTexture` 把帧打回第 0 帧）**不报错**，
 * 只表现为"看起来在跳"，前六轮全靠猜机制。有了这三个数，"在跳"就变成一个数字。
 */
const selfCheck = createSelfCheck({
  actors: () => (typeof scene2d.liveActors === 'function' ? scene2d.liveActors(world, meta?.scene ?? null) : []),
})

const scene2d = createScenePhaser(canvas, {
  renderer: requestedRenderer(),
  // **点击角色的真路径**（R66）：Phaser 的 `setInteractive` + `pointerup` 冒泡上来，
  // "忽略拖拽/长按"由引擎的 Pointer API（`getDistance`/`getDuration`）判断，
  // 我们不再自己记 downX/downY/downAt（那段手写 `bindPick` 已删）。
  // R58 修过的死角在这里同样成立：命中区就是精灵几何，点身体任意位置都算。
  // ① 场景点人：聚焦（选中 + 镜头）**已经由渲染层的 `selectAgent` 做过了**
  //（`scene-phaser.js` 的 `pointerup` 里先 `selectAgent` 再回调这里）——
  // `focusAgent` 对"已选中的同一个"是空操作，所以这里只管开面板。
  onActorPick: (agentId) => {
    focusAgent(agentId, 'scene')
    openDialogueFor(agentId)
  },
  // P4：玩家用键盘走完一段 → 把落点写回世界（否则服务端还停在旧坐标，解锁会瞬移回去）。
  onAgentMoveSettled: (agentId, x, z) => void sendCommand({ kind: 'moveAgent', agentId, x, z }),
})

/**
 * 看板的引用（R3）。为什么不是直接读 `board`：`createSidebar()` 在装配阶段就会**同步**回调
 * 一次（R99 起是初始化折叠态，更早是初始化页签），而那时下面 `const board = createBoard(...)`
 * 那一行**还没跑**。
 *
 * ⚠️ 这里**不能**用 `typeof board === 'undefined'` 兜：`typeof` 只对"从未声明"的标识符安全，
 * 对处在暂时性死区（TDZ）里的 `const` 一样抛 ReferenceError。第一版就是这么写的，
 * 结果整个 `main.js` 在装配阶段被中断——顶栏与侧边栏都在，场景与所有门面全没建，
 * 而控制台只有一条和看板毫无关系的 ReferenceError（真机踩到，R91）。
 * 所以用一只**先声明好的**可变引用承接。
 */
let boardRef = null

/**
 * 侧边栏（R2 建 / R3 收口 / R99 去 tab + 可折叠）。
 *
 * 这里**只建外壳**（折叠开关 + 两块常驻容器）。内容全部来自看板——同一份
 * `renderMembers` / `renderGraph` 的产物挂进去，所以不存在"侧边栏版"和"看板版"两套渲染。
 *
 * ⚠️ **R99：两个视图不再互斥**（用户：「这两个 tab 应该可以同时看到才对」），
 * 所以原先的 `onViewChange → refreshGraph()` 换成 `onExpand`：折叠期间两块容器是 0×0，
 * 依赖图必须在**展开并且布局落定之后**重挑几何。`onExpand` 已经在下一次 rAF 里，
 * 这里不用再延迟。
 */
const sidebar = createSidebar({
  root: $('sidebar'),
  onExpand: () => {
    boardRef?.refreshGraph()
  },
})

/**
 * 执行看板（M7-1 → R3：从顶栏搬进侧边栏）。
 *
 * **挂载模式**：不建顶栏摘要条，把成员档与任务图档分别挂到侧边栏的两块容器里。
 * `palette` 变量也挂在侧边栏上（`styleRoot`），两档都能继承到 `--board-*`。
 *
 * 数据仍是**事件驱动**（`board.update(world)`），不进 `render()` 那条 250ms 的路——
 * 这是"看板不拖慢场景"的前提。
 */
const board = createBoard({
  mounts: sidebar.mounts(),
  styleRoot: $('sidebar'),
  palette: {},
  // R97：**💬 按钮连同它那条回调一起删了**（用户拍板：与「点人 + 回车」重复）。
  // 现在只剩两条路：场景点人（聚焦 + 开面板）、成员行（只聚焦）。
  // 对话的另外两条入口都在 `main.js` 顶层：点场景里的人、选中后按回车。
  // ③ 成员**行**：只聚焦，**不开**面板。侧边栏里点谁，镜头就跟谁。
  onMemberSelect: (agentId) => void focusAgent(agentId, 'member'),
})
boardRef = board

dialogue = createDialogueUi({
  send: sayToAgent,
  onChanged: () => {
    render(true)
  },
  // P2：点「取消锁定」→ 解锁镜头（不关对话，只解除选中/跟随）。
  onUnlock: () => {
    if (typeof scene2d.clearSelection === 'function') scene2d.clearSelection()
  },
  // P3 地基：超控模式切换 → 开/关引擎的键盘操控（互斥：打字时不动，移动时不打字）。
  onModeChange: (mode) => {
    if (typeof scene2d.setMovementEnabled === 'function') scene2d.setMovementEnabled(mode === 'move')
  },
  maxAgeTicks: DIALOGUE_SILENT_TICKS,
})
dialogue.setTickSource(() => currentTick())

// ── 时钟 ──────────────────────────────────────────────────────────────────────

/**
 * 当前的 tick = 权威 tick + 本地滑走的那部分。
 * 没有变更事件的那些步不会产生任何事件，所以本地要自己往前走（见 connection.slippedTicks）。
 */
function currentTick() {
  if (world === null) return 0
  return world.tick + connection.slippedTicks(meta?.tickMs ?? 100)
}

/** 显示一行提示（3D 的问题、读不到世界都在这里说）。 */
function showHint(text) {
  if ($hint === null) return
  $hint.textContent = text ?? ''
  $hint.hidden = text === '' || text === null || text === undefined
}

// ── 气泡 ──────────────────────────────────────────────────────────────────────

/**
 * 头顶气泡（M6-5 → R76 进引擎 → R77 用本地 9-slice 美术面板）。
 *
 * 气泡现在是 **Phaser 对象**（NineSlice 面板 + Text + 状态点，世界坐标，随相机缩放平移），
 * 主循环只做一件事：从对话状态机拿 `[{agentId, phase, text}]` 交给场景画。
 * 名字**不进气泡**（气泡 vs 名字二选一：有气泡就藏头顶名字，气泡消失再露出来）。
 * 屏幕边缘避让/尾巴指向这些"贴边"逻辑随 DOM 层一起删掉了——世界坐标里气泡跟着人走，
 * 人走到画面边缘气泡自然跟着出画面，这是游戏该有的样子，不需要额外夹取。
 */
function updateBubbles() {
  if (meta === null) return
  const list = dialogue === null ? [] : dialogue.bubblesFor(performance.now())
  const enriched = []
  for (const bubble of list) {
    const agent = world?.agents.find((a) => a.id === bubble.agentId)
    if (agent === undefined) continue
    enriched.push({ agentId: bubble.agentId, phase: bubble.phase, text: bubble.text })
  }
  scene2d.renderBubbles(enriched)
}

// ── 渲染 ──────────────────────────────────────────────────────────────────────

function render(force = false) {
  if (world === null || meta === null) return
  const now = performance.now()
  if (!force && now - lastRenderMs < RENDER_MIN_GAP_MS) return
  lastRenderMs = now
  const tick = currentTick()

  scene2d.render({ world, scene: meta.scene, tick, messageDeliveryTicks: meta.messageDeliveryTicks })

  // 把渲染器的**真实计数**显示出来——"不卡"要能被看见，否则只是承诺（R57）。
  // 报 Phaser 用哪个渲染器、这一帧提交了几次 GL 绘制、画了多少个对象。
  // （绘制次数挂在 Phaser 的 prerender/postrender 钩子上数，不是我们多渲染一遍。）
  const sceneStats = scene2d.stats()
  const backendName = sceneStats.backend === 'canvas' ? 'Phaser(canvas)' : 'Phaser(WebGL)'
  // R84：**构建标记 + 朝向抖动计数**。
  // 为什么要它：这两个指标让"页面到底是不是新代码""朝向到底有没有在抖"变成**界面上能读的数**，
  // 不用再靠猜。之前两轮就是在"不知道用户跑的是哪份代码"的情况下改的，白改。
  const flips = trackAnimFlips()
  // R86：**自检读数**（帧重置 / 动画互抢 / 与世界漂移）。
  // 三个数正常时**恒为 0**——所以"不是 0"本身就是结论，不需要再去猜是哪一类。
  // 抽样自节流（800ms 一次），这条路是 250ms 一跳，加它不会让渲染变慢。
  selfCheck.sample()
  const perf = `${backendName} · 绘制 ${sceneStats.drawCalls}${sceneStats.batched === true ? '（合批）' : ''} · 精灵 ${sceneStats.sprites ?? '-'} · 切换 ${flips} · ${selfCheck.report().text} · ${BUILD}`
  topbar.render({
    world,
    meta,
    tick,
    perf,
    connected: connection.status().connected,
    nextSeq: connection.status().nextSeq,
    silentForMs: connection.silentForMs(),
    waiting: dialogue?.thinkingTurns().length ?? 0,
  })

  updateBubbles()
  // 面板只重画签名变了的东西；"他在想…（12s）"里的秒数靠这次调用更新。
  dialogue?.render(now)
  // 视野按钮的禁用态/倍数跟着渲染层走（接口没就位时显示 —，并全部禁用）
  syncViewControls()
}

// ── 发话（M6-5 的发送侧）──────────────────────────────────────────────────────

/**
 * 发一次话。**宿主拥有端点，面板只负责把失败翻成能下手的人话**
 *（`explainSayFailure` 在 `core/dialogue-state.js`）。
 *
 * 刻意**不重试**：契约说这条请求是同步收话，失败就是失败；
 * 静默重试只会让同一句话在宿主那边出现两遍，而用户完全不知道。
 */
async function sayToAgent({ agentId, text }) {
  const controller = new AbortController()
  // 收话应当**立刻**返回（模型在后台想）；等 10 秒还没回说明端点那边在等不该等的东西。
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(SAY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, text }),
      signal: controller.signal,
    })
    // 响应体可能是 HTML（404 页面、反向代理），所以解析失败也要能过去。
    const rawText = await res.text().catch(() => null)
    let body = null
    if (rawText !== null && rawText !== '') {
      try {
        body = JSON.parse(rawText)
      } catch {
        body = null
      }
    }
    if (!res.ok) return { ok: false, status: res.status, reason: body?.reason, text: rawText ?? undefined }
    if (body === null || body.accepted !== true) {
      return {
        ok: false,
        status: res.status,
        reason: body?.reason ?? (body === null ? '响应不是 JSON' : undefined),
        text: rawText ?? undefined,
      }
    }
    return { ok: true, turnId: body.turnId }
  } catch (error) {
    return { ok: false, status: 0, error }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 点到人之后：确保面板**开在这个人身上**（`docs/PLAN-game-agent.md` (d)4，用户 R97 拍板）。
 *
 * ## 为什么不再是 `toggle`
 *
 * 用户原话：「已经选中 A、面板开着时，再点一次 A → **不关面板，只是重新聚焦**」。
 * 旧行为是 `toggle`：再点同一个人会**关掉面板**——于是"想再确认下这个人"的顺手动作，
 * 反而把面板收走了。
 *
 * ## 为什么也**不能**直接 `dialogue.open(agentId)`
 *
 * `open()` 会把面板**重置回移动档**，并在对话档时重新聚焦输入框。于是：
 *   · 正在对话档打字的人，再点一下自己就会**被踢出输入框**（比关掉面板更烦）；
 *   · 已经切到对话档的人，会被悄悄降回移动档。
 * 那等于用"重置"来实现"重新聚焦"，副作用比原问题更大。
 *
 * ## 正确的三态（也别写成"同一个人就什么都不做"——面板关着时必须开）
 *
 * | 当前 | 做什么 |
 * |---|---|
 * | 面板关着 | `open(agentId)` → 默认移动档 |
 * | 开着、同一个人 | **no-op**（保持档位与焦点，不重置） |
 * | 开着、换人 | `open(新 id)` |
 */
function openDialogueFor(agentId) {
  if (agentId === null || agentId === undefined) return
  const sameAgentOpen = dialogue.isOpen() === true && dialogue.agentId() === agentId
  if (!sameAgentOpen) dialogue.open(agentId)
  render(true)
}

/**
 * 上一次聚焦是从哪条路来的（只给 `__agentWorld` 门面读，**不参与分支**）。
 *
 * ⚠️ 必须**声明在 `focusAgent` 之前**：`createScenePhaser()` 的装配是同步的，
 * 它会立刻注册回调；而这里一旦有同步调用路径（R91 已经踩过一次 TDZ），
 * 声明在后就是 `ReferenceError`，且症状和本轮改动毫无关系、极难归因。
 */
let lastFocusSource = null

/**
 * **聚焦的唯一入口**（R4 / DESIGN §6）：选中 + 镜头跟随。
 *
 * 三个入口（场景点人 / 成员行 / 💬）都走这里，`source` **只用于埋点**——
 * 写进 `__agentWorld.lastFocusSource`，验收时据此核对"三条路真的汇到了一处"。
 * ⚠️ **任何按 `source` 分叉行为都算违规**：那样它就不是唯一入口，只是三个入口的别名。
 *
 * ## 为什么"要不要开对话面板"**不**统一（不是遗漏，是拍板过的）
 *
 * 三处的可观察行为确实不同，而且**是有意的**（`docs/PLAN-game-agent.md` (d) 节，
 * 用户 R94 明确拍板）：
 *
 *   列表 = 定位（选中 + 镜头） · 点人 = 定位 + 开面板 · 回车 = 在已选中的基础上开对话
 *
 * ⚠️ **实现时不许"顺手统一"**：三处行为不同是设计的一部分。
 * ⚠️ 尤其注意：设计文档（task-2）里「点人只聚焦、对话走 Enter」那条**被用户否掉了**——
 * 下一个读到那份文档的人很容易照着它"纠正"这里的实现，所以这句话必须留在代码里。
 *
 * 本轮（R4）只把"选中 + 镜头"这段共同部分收进来，开面板由各调用点自己决定。
 *
 * ## 为什么"已经选中同一个就不再调 selectAgent"
 *
 * 这不是优化，是**为了行为不变**：`selectAgent` 每次都会重开一段 420ms 的镜头平移
 *（`startFollowSelection`）。而场景点人的路径上，`scene-phaser.js` 的 `pointerup`
 * **已经**调过 `selectAgent` 了——这里再调一次就会把刚开始的平移重新起一遍，
 * 用户看到的是"镜头顿一下再走"。聚焦一个已经聚焦的对象本来就该是空操作。
 *
 * @param {string} agentId
 * @param {'scene'|'member'} source - 仅埋点。第三种来源（💬 按钮那条）已在 R6 随按钮一并删除，别再把它加回来
 * @returns {boolean} 是否已是聚焦态
 */
function focusAgent(agentId, source) {
  if (typeof agentId !== 'string' || agentId === '') return false
  lastFocusSource = source
  if (typeof scene2d.selectAgent !== 'function') return false
  if (scene2d.selectedAgent?.() === agentId) return true
  return scene2d.selectAgent(agentId) === true
}




// ── 视野控制（R65）────────────────────────────────────────────────────────────
//
// 缩放/适配/复位由**渲染层**提供（R65 的视口改造）。这里只做三件事：
// ① 把按钮接上去；② 每帧按 `viewState()` 刷新"能不能再放大/缩小"的禁用态与倍数显示；
// ③ 接口还没就位时**明确禁用**——静默失效最难查（按钮在、点了没反应，看起来像渲染坏了）。
const viewControls = {
  zoomIn: document.querySelector('#cmd-zoom-in'),
  zoomOut: document.querySelector('#cmd-zoom-out'),
  fit: document.querySelector('#cmd-fit'),
  reset: document.querySelector('#cmd-reset'),
  zoomLabel: document.querySelector('#view-zoom'),
}

function viewStateOf() {
  if (typeof scene2d.viewState !== 'function') return null
  try {
    return scene2d.viewState()
  } catch {
    return null
  }
}

function syncViewControls() {
  const state = viewStateOf()
  const supports = state !== null
  const { zoomIn, zoomOut, fit, reset, zoomLabel } = viewControls
  if (zoomIn !== null) zoomIn.disabled = !supports || state.canZoomIn === false
  if (zoomOut !== null) zoomOut.disabled = !supports || state.canZoomOut === false
  if (fit !== null) fit.disabled = !supports || state.fitted === true
  if (reset !== null) reset.disabled = !supports
  if (zoomLabel !== null) zoomLabel.textContent = supports ? `${state.zoom}×` : '—'
}

for (const [id, method] of [['zoomIn', 'zoomIn'], ['zoomOut', 'zoomOut'], ['fit', 'fitView'], ['reset', 'resetView']]) {
  const button = viewControls[id]
  if (button === null) continue
  button.addEventListener('click', () => {
    if (typeof scene2d[method] !== 'function') return
    scene2d[method]()
    syncViewControls()
  })
}
syncViewControls()

// ── 世界命令（暂停/继续）──────────────────────────────────────────────────────

async function sendCommand(command) {
  // `command` 可以是 kind 字符串（暂停/继续），也可以是完整对象（如 moveAgent 要带坐标）。
  const payload = typeof command === 'string' ? { kind: command } : command
  try {
    const res = await fetch(COMMAND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: payload }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) showHint(`命令被拒（${res.status}）：${body.error ?? '宿主没说原因'}`)
    // 成功的话世界状态会经事件流回来（`world.paused` 事件），不需要手动刷新。
  } catch (error) {
    showHint(`命令没发出去：${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── 连接 ──────────────────────────────────────────────────────────────────────

const connection = createConnection({
  onSnapshot: (snap) => {
    // 快照成功拿到 → 之前那句"读不到世界"（通常是启动瞬间宿主的瞬态错误）可以收起来了。
    showHint('')
    world = snap.world
    meta = {
      scene: snap.scene,
      libraries: snap.content.libraries,
      packs: snap.content.packs,
      theme: snap.scene?.theme ?? null,
      // 看板的颜色 token → 色值。**配色是内容**：面板只从快照里拿这份表。
      palette: snap.palette ?? {},
      tickMs: snap.runtime.tickMs,
      messageDeliveryTicks: snap.runtime.messageDeliveryTicks,
      persistErrors: snap.runtime.diagnostics.persistErrors,
    }
    diagnostics = snap.runtime.diagnostics ?? null
    // 标题跟世界名走（R74）：世界叫什么，顶栏就显示什么——除非用户自己改过。
    topbar.setWorldName(world.name)
    // 角色的名字只从世界数据来（D37：人设是内容，代码里没有角色名）。
    dialogue.setAgents(world.agents)
    board.setPalette(meta.palette)
    // 流水线目录（id → 中文名）也由服务端下发：前端不许自己翻译内容（R46）。
    // ⚠️ 读 `snap.taskSets` 而**不是** `meta.taskSets`：`meta` 是一个显式挑字段的对象，
    // 没有的字段就是 `undefined`——第一版写成 meta.taskSets，于是每次都把目录清空成 {}，
    // 分组签一直显示英文短 id（真机上抓到的）。
    board.setTaskSets?.(snap.taskSets)
    board.update(world, { diagnostics })
    legend.update({ scene: meta.scene })
    render(true) // 首屏**强制**画一次：节流不该让"打开面板"这一步被跳过
  },
  onEvents: (events) => {
    applyEvents(world, events)
    pruneMessages(world)
    // R3：侧边栏**没有自己的数据路径**了——看板那一份渲染直接挂进了它的两档。
    board.update(world, { diagnostics })
    render()
  },
  onSync: () => {
    // 心跳顺带查一遍"有没有哪句话等太久了"：宿主挂了的话 `failed` 永远不会来。
    dialogue?.expire(currentTick(), performance.now())
    render()
  },
  onMessage: (message) => {
    // 对话帧（M6-5）。帧的确切形状**不在冻结的契约里**，所以形状由
    // `dialogueEventsFromFrame` 认（独立帧、夹在世界事件批里、事件本体都认）；
    // 认不出就当没这条——**一条未知的帧不能把事件流带停**。
    const dialogueEvents = dialogueEventsFromFrame(message)
    if (dialogueEvents.length > 0) dialogue?.ingest(dialogueEvents, performance.now())
  },
  onError: (failure) => {
    if (failure.kind === 'snapshot-http') {
      showHint(`读不到世界（HTTP ${failure.status}）：${failure.body?.error ?? '宿主没说原因'}`)
    } else if (failure.kind === 'snapshot-failed') {
      showHint(`读不到世界：${failure.error instanceof Error ? failure.error.message : String(failure.error)}`)
    }
  },
  onState: () => render(),
})

// ── 生命周期 ──────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  scene2d.resize()
  render(true)
})

// R3：看板从顶栏搬进侧边栏之后**没有"收起"这回事**了——它常驻在侧边栏里，
// 两档由页签切换（`setCollapsed` 在挂载模式下是空操作，这里不再调它）。

// 本地时钟的可见部分：每 250ms 重画一次，让"没事件但时间在走"看得见，
// 也让纸条与气泡在两次事件之间平滑移动。**看板不在这条路上**（它由数据事件驱动）。
setInterval(render, 250)

// `?debug=1` 时才把核验入口挂出去（跟 `__agentWorldScene3d` 同一个口径）。
if (new URLSearchParams(globalThis.location?.search ?? '').has('debug')) {
  globalThis.__agentWorldDialogue = {
    state: dialogue.state,
    ingest: (events) => dialogue.ingest(events, performance.now()),
    // `push(帧)`：**推一整条 SSE 帧**（`{type:'dialogue', events:[…]}` / 事件本体都行）。
    // 存在的理由：临时服务器没有 DSH 会话服务，真模型帧拿不到，而"帧到了面板之后的表现"
    // 必须能被验（M6-13 的 acting / 动作行就是这么验的，见 PROGRESS R35）。
    push: (frame) => {
      const events = dialogueEventsFromFrame(frame)
      dialogue.ingest(events, performance.now())
      return events.length
    },
    expire: (nowTick) => dialogue.expire(nowTick, performance.now()),
    bubbles: () => dialogue.bubblesFor(performance.now()),
    say: sayToAgent,
    // 超控双模式：核验「对话 ↔ 移动」切换是否真的把焦点/引擎开关一起搬了。
    mode: () => dialogue.mode(),
    setMode: (mode) => dialogue.setMode(mode),
    isOpen: () => dialogue.isOpen(),
    open: (agentId, mode) => dialogue.open(agentId, mode),
    close: () => dialogue.close(),
  }
  /**
   * 2D 渲染的核验入口（R51）：缩放倍数、图集加载状态、某个图集的调色板。
   *
   * 为什么值得挂出来：像素画的错法（缩放取小数、图集没加载、切图切错）**都不会报错**，
   * 只会"看起来怪"。有这三个读数，问题能当场定位到"是没加载、还是切错了、还是缩放不对"。
   */
  globalThis.__agentWorldScene2d = {
    // R57：渲染后端的实际读数（Pixi 合批数 / canvas2D 提交次数）+ 降级原因。
    stats: () => scene2d.stats(),
    backend: () => scene2d.backend(),
    calls: () => scene2d.calls(),
    /** 与 3D 的 `projectToScreen` 同义：给"点选行为有没有变"做对照。 */
    pickAt: (clientX, clientY) => scene2d.pick({ world, scene: meta?.scene, clientX, clientY }),
    anchorAt: (agentId) => scene2d.anchorOf({ world, scene: meta?.scene, agentId }),
    metrics: () => scene2d.metrics(meta?.scene ?? null),
    loader: () => scene2d.loader.status(),
    palette: (url) => scene2d.loader.palette(url),
    recolored: (url, color, variant = 0) => scene2d.loader.recoloredImage(url, color, variant),
    liveActors: () => scene2d.liveActors(world, meta?.scene ?? null),
    /**
     * R86：**渲染自检读数**（一帧里比对出来的一致性）。
     *
     * 返回 `{text, counts, last, world, verdict}`：
     * - `counts.frameResets` 精灵实际帧 ≠ 动画当前帧（有人重置了帧，R85 就是这类）；
     * - `counts.animFlips` 动画键 A→B→A 来回翻（互抢；单向前进不算）；
     * - `counts.facingDrift` 本地世界与服务端快照的 `facing` 连续两次对不上。
     * **正常时三个数恒为 0**；不是 0 就说明这一类故障真的发生了。
     */
    selfCheck: () => selfCheck.report(),
    // R77：把气泡绘制也挂出来，页内就能验 9-slice 面板 / 文字 / 状态点 / 名字二选一。
    renderBubbles: (bubbles) => scene2d.renderBubbles(bubbles ?? []),
    // R65 视图控制：暴露出来**是为了能在页内直接验**（缩放/平移是交互，靠点按钮猜很难归因）。
    viewState: () => (typeof scene2d.viewState === 'function' ? scene2d.viewState() : null),
    zoomIn: () => scene2d.zoomIn?.(),
    zoomOut: () => scene2d.zoomOut?.(),
    fitView: () => scene2d.fitView?.(),
    resetView: () => scene2d.resetView?.(),
    camera: () => {
      const scene = window.__agentWorldPhaser?.scene?.()
      const cam = scene?.cameras?.main
      if (cam === undefined || cam === null) return null
      return {
        zoom: cam.zoom,
        scrollX: Math.round(cam.scrollX),
        scrollY: Math.round(cam.scrollY),
        bounds: cam._bounds ? { x: Math.round(cam._bounds.x), y: Math.round(cam._bounds.y), w: Math.round(cam._bounds.width), h: Math.round(cam._bounds.height) } : null,
      }
    },
    // P1 选中 / P2 锁定：页内直接验「点人 / 看板定位 → 高亮圈 + 镜头跟随」。
    selectAgent: (agentId) => (typeof scene2d.selectAgent === 'function' ? scene2d.selectAgent(agentId) : false),
    clearSelection: () => scene2d.clearSelection?.(),
    selectedAgent: () => (typeof scene2d.selectedAgent === 'function' ? scene2d.selectedAgent() : null),
    following: () => (typeof scene2d.following === 'function' ? scene2d.following() : null),
    movementEnabled: () => (typeof scene2d.movementEnabled === 'function' ? scene2d.movementEnabled() : null),
    manualState: () => (typeof scene2d.manualState === 'function' ? scene2d.manualState() : null),
    setMovementEnabled: (on) => (typeof scene2d.setMovementEnabled === 'function' ? scene2d.setMovementEnabled(on) : null),
  }

  /**
   * 气泡的核验入口（R39 → R76）。
   *
   * R76 起气泡是**引擎内 Phaser 对象**（不再有 DOM 层、也没有屏幕边缘夹取/遮挡那套）。
   * 这里只报**数据侧**（对话状态机给什么）；绘制在 Phaser 场景里，核对走 `__agentWorldScene2d`。
   */
  globalThis.__agentWorldBubbles = {
    list: () => {
      const list = dialogue === null ? [] : dialogue.bubblesFor(performance.now())
      return list.map((b) => {
        const agent = world?.agents.find((a) => a.id === b.agentId)
        return { agentId: b.agentId, name: agent?.name ?? null, phase: b.phase, text: b.text }
      })
    },
  }
  globalThis.__agentWorldBoard = {
    stats: () => board.stats(),
    refresh: () => board.update(world, { diagnostics }),
    select: (taskId) => board.select(taskId),
    model: () => board.model(),
    layout: () => board.layout(),
    geometry: () => board.geometry(),
    /** 当前选中的任务 id（R3：`select()` 是写入口，读入口一直在 board 上没暴露）。 */
    selected: () => board.selected(),
    /**
     * 重挑依赖图几何（R99）。核验"折叠→展开之后图还有几何"时直接调它，
     * 不必依赖 rAF/定时器的时序——那条时序本身就是最容易被环境坑住的地方。
     */
    refreshGraph: () => board.refreshGraph(),
    // `clipped()` 由 board.js 自己在同一个宏任务里挂（它先于 app 的门面创建）。
    // R99：`showGraph()` 已删——两块现在**同时可见**，不存在"切到某一档"这个动作。
    // 留一个已经不存在的动作，验收脚本会以为还能用它。
    // R46：分组/状态过滤（= 界面上那两排 chip 的同一条路径，核验用）。
    setView: (next) => board.setView(next),
    setMembersOpen: (open) => board.setMembersOpen(open),
  }
  /**
   * 聚焦入口的核验面（R4）。
   *
   * `lastFocusSource` 是**验收的判据**：点过三个入口之后它分别是 `scene` / `member` / `talk`，
   * 说明三条路真的汇到了同一个 `focusAgent`。它**只用于埋点**——
   * 若哪天有人写了 `if (source === 'member') …`，这个字段就会成为唯一的证据。
   */
  globalThis.__agentWorld = {
    lastFocusSource: () => lastFocusSource,
    selectedAgent: () => (typeof scene2d.selectedAgent === 'function' ? scene2d.selectedAgent() : null),
    focus: (agentId, source) => focusAgent(agentId, source ?? 'debug'),
    /**
     * 三个入口各自**现在**的可观察行为（`selectedAgent / following / dialogueOpen`）。
     *
     * 存在的理由：本轮是"行为不变的重构"，而"没变"这件事必须能被**逐条读出来**，
     * 否则下一轮谁都说不清改之前是什么样。这张表就是 DESIGN §6 那张表的运行时版本。
     */
    focusMatrix: () => [
      { source: 'scene', 选中: true, 开面板: true, 说明: '场景点人：渲染层先 selectAgent，回调再开面板（(d)1）' },
      { source: 'member', 选中: true, 开面板: false, 说明: '成员行：只聚焦（(d)3）' },
      // R97：`talk`（💬）那条**已删**——按钮与回调一起清掉了，这里也就不该再有它。
      // 留着一条已不存在入口的"行为表"比没有表更坏：验收会照着它去找一个不存在的按钮。
    ],
  }
  /**
   * 侧边栏的核验入口（R2）：两档切换与行数——以及**溢出判据**（M7-9：
   * 元素的盒子必须落在「容器 ∩ 视口」里）。溢出是那种"看起来正常"的错：
   * 它不报错，只是内容被裁掉，所以必须能被量出来。
   */
  globalThis.__agentWorldSidebar = {
    stats: () => sidebar.stats(),
    /** 折叠态与开关（R99：两块同时可见，所以没有"切档"，只有"折叠/展开"）。 */
    collapsed: () => sidebar.collapsed(),
    toggle: () => sidebar.toggle(),
    setCollapsed: (next) => sidebar.setCollapsed(next),
    /** 溢出判据（M7-9）：元素盒子必须落在「最近的可滚祖先 ∩ 视口」里。 */
    overflow: (selector) => sidebar.overflow(selector),
  }
}

// ── 键盘：Esc 退出锁定 / Enter 开始对话 ─────────────────────────────────────
//
// 焦点在输入框里时**不拦**：Enter 要能正常发送、Esc 由输入框自己处理（它会 close + 解锁）。
// 只有焦点不在文字输入上，这两个键才是"超控面板"的快捷键。
globalThis.document?.addEventListener('keydown', (event) => {
  const tag = String(globalThis.document.activeElement?.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'INPUT') return
  if (dialogue === null) return

  if (event.key === 'Escape') {
    event.preventDefault()
    // 退出锁定 = 解锁镜头 + 收起面板（面板是"操控这个人"的上下文，人不锁了就收起）。
    dialogue.close()
    if (typeof scene2d.clearSelection === 'function') scene2d.clearSelection()
    return
  }

  if (event.key === 'Enter') {
    const agentId = typeof scene2d.selectedAgent === 'function' ? scene2d.selectedAgent() : null
    if (agentId === null || agentId === undefined) return
    event.preventDefault()
    // 回车开始对话：面板没开就**以对话档**打开（open 默认是移动档，这里必须显式要 chat）。
    if (dialogue.isOpen() !== true) dialogue.open(agentId, 'chat')
    else dialogue.setMode('chat')
  }
})

scene2d.resize()
void connection.reload()
connection.start()
