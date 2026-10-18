/*
 * 渲染自检（R7 / 计划 S1 + S2）—— **把"静默故障"变成页面上能读的数**。
 *
 * 为什么单独一个文件：这三类故障（帧被重置 / 动画互抢 / 客户端与服务端漂移）
 * 都**不报错**，只表现为"看起来在跳""看起来有点歪"。R80–R85 六轮都是因为
 * 没有读数，只能靠猜机制，猜了六次。这里把两处现成的读数变成计数器：
 *
 *   1. **帧重置**：`sprite.frame.name`（精灵实际显示的帧）
 *      vs `sprite.anims.currentFrame.textureFrame`（动画认为该显示的帧）。
 *      不相等 ⇒ 有东西在动画之外改了帧（R85 的真凶就是 `setTexture` 顺手 `setFrame`）。
 *   2. **动画互抢**：同一只精灵的动画键 A → B → A 来回翻（单向前进不算，那是正常的
 *      走路换向）。比"动画键变化次数"更准：正常上班一天会换几十次键，但**不会来回翻**。
 *   3. **状态漂移**：`liveActors()` 的 `facing` 与服务端快照的 `facing` 对不上。
 *      服务端是权威，客户端只是显示——不一致就说明增量没落到本地世界。
 *
 * ## 三条设计约束（都很容易踩）
 *
 * - **不许拖慢渲染**：本模块只做"读一帧的精灵列表 + 偶尔一次 fetch"，
 *   按 `intervalMs` 自节流。渲染那条路是 250ms 一跳，不是 60fps；这里再稀一档。
 * - **纯逻辑，不碰 DOM/Phaser**：所以能在 node 里测（见 test/self-check.test.js）。
 *   取精灵列表、取 actor 列表、拉快照都由调用方注入。
 * - **一次不一致 ≠ 漂移**：`facing` 的变化和服务端推送之间**天然有一两帧的时差**
 *   （增量还没到）。所以漂移要求**跨两个快照代次**都看到同一个不一致值才算数。
 *   否则这个计数器会被正常时序刷成噪声，那比没有读数更糟——它会教人忽略它。
 *
 *   ⚠️ R110 修的就是这条：原先写的是"**连续两次抽样**"，而**没区分那两次是不是同一个基线**。
 *   `serverFacing` 每 3s 才刷新，两次之间是冻结的——于是"同一个冻结基线内采两次"被当成了
 *   "两次独立观测"，`D` 开始误报（实测：它报 `last.drift: 1` 时，独立比对 8/8 完全一致）。
 *   现在绑到 `serverGeneration` 上：**同一代次内采多少次都不累积**。
 *   这条对**仪表**尤其致命：一个会误报的仪表，会让它之前所有干净的 `D0` 都失去意义。
 * - **没测 ≠ 通过**：快照是异步慢档拉的，还没到手时漂移项根本没比过。
 *   这时摘要写 `D?` 且 `verdict` 是 `unverified`，不许显示成"没问题"。
 */

/** 朝向比较容差（弧度）。服务端和本地都存同一份浮点数，只防序列化的末位误差。 */
const FACING_EPSILON = 1e-6

/** 默认抽样间隔：800ms。渲染 250ms 一跳，所以大约每 3 跳抽一次。 */
const DEFAULT_INTERVAL_MS = 800
/** 拉一次服务端快照的间隔：3s。比抽样慢得多——漂移是慢性病，不需要秒级。 */
const DEFAULT_WORLD_FETCH_MS = 3000

/** 帧名可能是 `__BASE`（整张图）这类非数字名字，只有数字帧才有"帧号"可比。 */
function frameIndexOf(sprite) {
  const name = Number(sprite?.frame?.name)
  return Number.isFinite(name) ? name : null
}

/** 动画当前帧的纹理帧号；没在播 / 拿不到就是 null。 */
function animFrameIndexOf(sprite) {
  const raw = sprite?.anims?.currentFrame?.textureFrame
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** 读一帧的精灵列表：只要 `entities` 层里可见的 Sprite。 */
function defaultSprites() {
  const list = globalThis.__agentWorldPhaser?.scene?.()?.layers?.entities?.list
  if (Array.isArray(list) !== true) return []
  return list.filter((object) => object?.type === 'Sprite' && object.visible !== false)
}

/** 一只精灵的稳定标识：优先 actorId（`drawActors` 打的），退化到列表下标。 */
function spriteKeyOf(sprite, index) {
  const actorId = typeof sprite?.getData === 'function' ? sprite.getData('actorId') : null
  return typeof actorId === 'string' ? actorId : `#${index}`
}

/**
 * 建一个自检器。
 *
 * @param {object} [options]
 * @param {() => Array<object>} [options.sprites] - 取当前帧的精灵列表（默认读 Phaser 的 entities 层）
 * @param {() => Array<object>} [options.actors] - 取 `liveActors()`（客户端世界）
 * @param {() => Promise<object>} [options.fetchWorld] - 拉服务端快照（默认 `GET ./api/world`）
 * @param {number} [options.intervalMs] - 抽样间隔
 * @param {number} [options.worldFetchMs] - 快照间隔
 * @param {() => boolean} [options.hidden] - 页面是否不可见（不可见就不拉快照，省请求）
 * @param {() => number} [options.now] - 时间源（测试注入）
 */
export function createSelfCheck(options = {}) {
  const sprites = options.sprites ?? defaultSprites
  const actors = options.actors ?? (() => [])
  const fetchWorld = options.fetchWorld ?? defaultFetchWorld
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_INTERVAL_MS
  const worldFetchMs = Number(options.worldFetchMs) > 0 ? Number(options.worldFetchMs) : DEFAULT_WORLD_FETCH_MS
  const hidden = options.hidden ?? (() => globalThis.document?.hidden === true)
  const now = options.now ?? (() => performance.now())

  /** 累计计数（只增不减——"曾经出过错"这件事本身要留下）。 */
  const counts = {
    /** 精灵实际帧 ≠ 动画当前帧 的次数（每只精灵每次抽样最多记 1）。 */
    frameResets: 0,
    /** 动画键 A→B→A 来回翻的次数。 */
    animFlips: 0,
    /** 客户端 facing 与服务端对不上的次数。 */
    facingDrift: 0,
  }
  /** 最近一次抽样的明细，给 `selfCheck()` 读。 */
  let last = {
    at: 0,
    sprites: 0,
    compared: 0,
    resets: 0,
    drift: 0,
  }
  /** 上一帧的动画键（按精灵标识）。 */
  let lastAnimKeys = new Map()
  /** 再上一帧的动画键——A→B→A 里的第一个 A 在这里。 */
  let prevAnimKeys = new Map()
  /** 每个 agent 上一次的朝向不一致（**跨快照代次**才算漂移，见 `serverGeneration`）。 */
  let pendingDrift = new Map()
  /** 服务端快照里每个 agent 的 facing（异步拉的，可能是旧的，没关系）。 */
  let serverFacing = new Map()
  let serverFacingAt = 0
  /**
   * **服务端快照的代次**（R110）：每成功拉到一次快照就 +1。
   *
   * 为什么需要它（这是修一个**我们自己的仪表在说谎**的 bug）：
   * 原先"连续两次抽样看到同一个不一致值"的判据，**没有区分那两次是不是同一个基线**。
   * 而 `serverFacing` 每 3s 才刷新一次、两次之间是**冻结的**——于是"在同一个冻结基线内
   * 采两次"被当成了"两次独立观测"，`D` 就开始误报。
   *
   * 判据改成：**只有跨两个不同的代次都看到同一个不一致值，才算一次漂移**。
   * 同一个代次内无论采多少次，都不累积（那不是两次观测，是同一个基线看了两眼）。
   */
  let serverGeneration = 0
  let lastSampleMs = -Infinity
  let lastFetchMs = -Infinity
  let fetching = false
  /** 最近一次拉快照的结果，用来区分"没漂移"和"根本没取到"。 */
  let fetchState = 'idle'

  /** 抽一次样。调用方随便高频调，内部按 `intervalMs` 自节流。 */
  function sample() {
    const at = now()
    if (Number.isFinite(at) && at - lastSampleMs < intervalMs) return counts
    lastSampleMs = at

    const list = sprites() ?? []
    const animKeys = new Map()
    let resets = 0
    let compared = 0
    for (let i = 0; i < list.length; i += 1) {
      const sprite = list[i]
      const key = spriteKeyOf(sprite, i)
      // ── 动画互抢：A → B → A ──────────────────────────────────────────────
      const animKey = sprite?.anims?.currentAnim?.key ?? ''
      animKeys.set(key, animKey)
      if (lastAnimKeys.get(key) !== animKey && prevAnimKeys.get(key) === animKey) {
        counts.animFlips += 1
      }
      // ── 帧重置：实际帧 vs 动画帧 ────────────────────────────────────────
      // 只在**动画正在播**时比：没在播时 `currentFrame` 停在最后一帧，而
      // `drawActors` 会显式 `setFrame(第一帧)` 钉住——那是**有意为之**，不是故障。
      if (sprite?.anims?.isPlaying !== true) continue
      const actual = frameIndexOf(sprite)
      const expected = animFrameIndexOf(sprite)
      if (actual === null || expected === null) continue
      compared += 1
      if (actual !== expected) resets += 1
    }
    counts.frameResets += resets
    prevAnimKeys = lastAnimKeys
    lastAnimKeys = animKeys

    // ── 状态漂移：客户端世界 vs 服务端快照 ────────────────────────────────
    let drift = 0
    if (serverFacing.size > 0) {
      const nextPending = new Map()
      for (const actor of actors() ?? []) {
        const authoritative = serverFacing.get(actor?.id)
        if (typeof authoritative !== 'number') continue
        const local = Number(actor?.facing)
        const mismatched = !Number.isFinite(local) || Math.abs(local - authoritative) > FACING_EPSILON
        if (!mismatched) continue
        /**
         * 同一个不一致值要**跨两个快照代次**才记一次漂移（R110）。
         *
         * 三件事被这条判据同时满足：
         *   ① **单向时序差**被吸收：本地还没追上服务端时，下个代次里本地就跟上了 → 签名消失，不记；
         *   ② **同一代次内重复采样不算数**：基线没换，采一百次也只是"同一个快照看了两眼"；
         *   ③ **真漂移仍然抓得住**：本地卡在同一个错值、而服务端基线已经换了一代还说那个值
         *      → 说明至少隔了一个快照周期（3s）还没追上，那就是真的没在同步。
         *
         * ⚠️ 签名里**必须带服务端的值**：只比"本地值没变"是不够的——
         * 本地值没变但服务端也一直在同一个值上，那是**一致**，压根不会走到这里。
         */
        const signature = `${Number.isFinite(local) ? local.toFixed(6) : 'NaN'}|${authoritative.toFixed(6)}`
        const prev = pendingDrift.get(actor.id)
        if (prev !== undefined && prev.signature === signature && prev.generation < serverGeneration) drift += 1
        nextPending.set(actor.id, { signature, generation: serverGeneration })
      }
      pendingDrift = nextPending
      counts.facingDrift += drift
    }

    last = { at: Number.isFinite(at) ? Math.round(at) : 0, sprites: list.length, compared, resets, drift }

    // 拉快照：慢档 + 页面可见才拉（后台标签页里没人看，没必要耗请求）。
    if (fetching !== true && hidden() !== true && (Number.isFinite(at) ? at - lastFetchMs >= worldFetchMs : true)) {
      lastFetchMs = Number.isFinite(at) ? at : now()
      fetching = true
      fetchState = 'pending'
      void Promise.resolve()
        .then(() => fetchWorld())
        .then((snapshot) => {
          serverFacing = facingMapOf(snapshot)
          serverFacingAt = Math.round(now())
          fetchState = serverFacing.size > 0 ? 'ok' : 'empty'
          // R110：**换了一代基线**。漂移判据要求"跨代次"，所以这一步是判据的一部分——
          // 忘了 +1 的后果是 `D` **永远为 0**（再也不报警），比误报更危险：
          // 一个永远说"没事"的仪表看起来和"真没事"一模一样。
          if (serverFacing.size > 0) serverGeneration += 1
        })
        .catch(() => {
          fetchState = 'failed'
        })
        .finally(() => {
          fetching = false
        })
    }
    return counts
  }

  /**
   * 可读结构：`__agentWorldScene2d.selfCheck()` 返回它。
   *
   * ⚠️ **"没测"不能读成"没问题"**。漂移那一项要比的是服务端快照，而快照是慢档异步拉的
   * （后台标签页按设计根本不拉）。这时 `D0` 只意味着"一次都没比过"——和"比过且一致"
   * 长得一模一样，而这正是本任务要消灭的静默形态。所以 `verdict` 分三档，且摘要里
   * 没测过时写 `D?` 而不是 `D0`。
   */
  function report() {
    const tested = serverFacing.size > 0
    const clean = counts.frameResets === 0 && counts.facingDrift === 0
    return {
      // 一行给性能条用的短摘要。
      text: `R${counts.frameResets} F${counts.animFlips} D${tested ? counts.facingDrift : '?'}`,
      counts: { ...counts },
      last: { ...last },
      sample: { intervalMs, sprites: last.sprites },
      world: { fetchState, facingCount: serverFacing.size, at: serverFacingAt, generation: serverGeneration },
      /**
       * `ok` = 两类都**比过且一致**；`degraded` = 真的出过错；
       * `unverified` = 帧比过了、但漂移一项还没比过（快照没到手）。
       */
      verdict: clean !== true ? 'degraded' : (tested === true ? 'ok' : 'unverified'),
    }
  }

  return {
    sample,
    report,
    counts: () => ({ ...counts }),
    /**
     * 测试/复验用：直接把服务端朝向塞进来，不必真发请求。
     *
     * ⚠️ 它**也会 +1 代次**（R110）：这是"来了一份新快照"的等价物。
     * 不 +1 的话调用方会以为自己在换基线，而判据还认为"同一个代次"，于是漂移永远数不出来——
     * 一个测试辅助函数悄悄让判据失效，是最难查的那种测试污染。
     */
    setServerFacing: (map) => {
      serverFacing = map instanceof Map ? map : new Map(Object.entries(map ?? {}))
      serverFacingAt = Math.round(now())
      if (serverFacing.size > 0) serverGeneration += 1
    },
    reset: () => {
      counts.frameResets = 0
      counts.animFlips = 0
      counts.facingDrift = 0
      lastAnimKeys = new Map()
      prevAnimKeys = new Map()
      pendingDrift = new Map()
    },
  }
}

/** 从快照里取 `{agentId: facing}`。快照可能是 `{world}`、也可能是 `world` 本身。 */
export function facingMapOf(snapshot) {
  const world = snapshot?.world ?? snapshot
  const list = Array.isArray(world?.agents) ? world.agents : []
  const map = new Map()
  for (const agent of list) {
    if (typeof agent?.id !== 'string') continue
    if (Number.isFinite(agent.facing)) map.set(agent.id, agent.facing)
  }
  return map
}

/** 默认的取快照方式：与 `net/connection.js` 同一个端点（相对路径，跟着面板走）。 */
async function defaultFetchWorld() {
  const res = await fetch('./api/world', { headers: { Accept: 'application/json' } })
  if (res.ok !== true) throw new Error(`world HTTP ${res.status}`)
  return await res.json()
}
