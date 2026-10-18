/*
 * 连接层：**一次快照 + 一条 SSE 增量流**（R32 从旧的 854 行 `app.js` 里抽出来，行为不变）。
 *
 * ── 数据流（面板的总规矩，别在这里加第二条通道）────────────────────────────────
 *
 *   1) 启动拉一次全量快照（`GET api/world`）；
 *   2) 之后只收 `EventSource(api/events)` 推来的增量，就地应用到本地世界。
 *
 * **没有轮询分支**。两条路都活着就会有两个真相：一边轮询一边收增量，
 * 出现不一致时根本判断不出是谁错的。断线由 `EventSource` 自己重连
 * （服务端会按 `Last-Event-ID` 补发断线期间的事件），所以不需要兜底轮询。
 *
 * ── 这一层只管"字节进出"，不管世界 ──────────────────────────────────────────
 *
 * 解析出来的世界交给 `onSnapshot` / `onEvents` 回调，由装配处（`main.js`）决定怎么用。
 * 这样"快照 + 增量"这套协议逻辑与"画什么"分开，前者能单独读、单独查。
 */

import { decideOnBatch } from '../core/world-update.js'

/** 超过这么久没收到任何消息（含 sync 心跳），状态栏就该明说（调用方用它判"过期"）。 */
export const STALE_AFTER_MS = 8000
/** 两次重拉快照之间至少隔这么久（异常情况下不要形成请求风暴）。 */
const RESYNC_MIN_GAP_MS = 1000

/**
 * 判"事件流卡住"的**兜底**心跳假设（毫秒）。
 *
 * ⚠️ 这是一个**最后手段**的假设值，正常情况下用不到：
 *   ① 服务端在 `hello` 帧里报 `heartbeatMs` → 用它（最准）；
 *   ② 没报就**实测**：记下两次 `sync` 之间的间隔，用观测值。
 * 只有"刚连上、还没观测到任何一次心跳"时才会落到这里。
 *
 * 为什么必须有一个远大于心跳的值：R108 的真凶就是**阈值比心跳还短**——
 * 服务端心跳 15s，而这里原先是 8s，于是**健康连接每 15 秒里必有约 7 秒被判成"过期"**，
 * 底栏就一直在喊「N 秒没收到事件」。那不是"世界安静"，那是阈值算错了。
 */
const ASSUMED_HEARTBEAT_MS = 15_000

/** 判过期的下限：再乐观也不该低于这个（防止把正常的抖动当故障）。 */
const MIN_STALE_MS = 20_000

/**
 * 建一条连接。
 *
 * @param {object} options
 * @param {(snap: object) => void} options.onSnapshot - 拿到全量快照（启动时、以及发现 gap/reset 时）。
 * @param {(events: object[]) => void} options.onEvents - 一批增量（已确认与本地 seq 接得上）。
 * @param {(message: object) => void} [options.onSync] - 权威时间心跳。
 * @param {() => void} [options.onReset] - 服务端明说"补不齐"。
 * @param {(state: object) => void} [options.onState] - 连接状态变化（面板据此重画状态栏）。
 * @param {(error: unknown) => void} [options.onError] - 读快照失败等。
 * @returns {object} `{ start, reload, status, slippedTicks, silentForMs, staleAfterMs, stop }`
 */
export function createConnection(options = {}) {
  const snapshotApi = options.snapshotApi ?? './api/world'
  const eventsApi = options.eventsApi ?? './api/events'
  const snapshotTimeoutMs = options.snapshotTimeoutMs ?? 5000
  const resyncMinGapMs = options.resyncMinGapMs ?? RESYNC_MIN_GAP_MS

  /** **下一个期望**的事件序号（不是「已经消费的最后一个」）。 */
  let nextSeq = 1
  /** 连接状态（事件流）。 */
  let connected = false
  /** 最近一次收到任何消息的墙钟时刻（判"过期"用）。 */
  let lastMessageMs = 0
  /** 本地时钟的基准：最近一次收到权威时间的墙钟时刻。 */
  let syncBaseMs = 0
  /** 上一次重拉快照的时刻（给重拉做节流）。 */
  let lastResyncMs = 0
  /** 服务端在 `hello` 里报的心跳间隔；没报就是 `null`（R108）。 */
  let heartbeatHintMs = null
  /** 观测到的最长 `sync` 间隔（服务端没报时的实测兜底）。 */
  let observedSyncGapMs = 0
  /** 上一次收到 `sync` 的时刻（算上面那个观测值）。 */
  let lastSyncAtMs = 0
  let source = null
  let stopped = false

  const emitState = () => options.onState?.({ connected, nextSeq, lastMessageMs, syncBaseMs })

  /**
   * 多久没消息才算"事件流卡住"（R108）。
   *
   * 判据是**心跳节奏的两倍多一点**（容忍一次漏跳）：正常时心跳每 N 秒来一次，
   * 所以"超过 2N 还没动静"才是真的出了问题。
   *
   * ⚠️ 这个数**必须大于心跳间隔**——R108 的 bug 就是阈值（8s）比心跳（15s）短，
   * 于是健康连接也一直被报警。**别再把阈值写成一个与心跳无关的常数。**
   */
  function staleAfterMs() {
    const hint = heartbeatHintMs ?? (observedSyncGapMs > 0 ? observedSyncGapMs : ASSUMED_HEARTBEAT_MS)
    // 两倍心跳 + 5s 余量：容忍一次漏跳与网络抖动。
    return Math.max(MIN_STALE_MS, Math.round(hint * 2 + 5000))
  }

  /** 拉一次全量快照。启动时、以及发现 gap/reset 时用。 */
  async function reload() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), snapshotTimeoutMs)
    try {
      const res = await fetch(`${snapshotApi}?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        options.onError?.({ kind: 'snapshot-http', status: res.status, body })
        return false
      }
      const snap = await res.json()
      // 快照的 `seq` 就是「下一个要分配的号」，所以直接赋值——这正是修掉那个 bug 的关键一步。
      nextSeq = snap.seq
      syncBaseMs = performance.now()
      lastMessageMs = performance.now()
      options.onSnapshot?.(snap)
      emitState()
      return true
    } catch (error) {
      options.onError?.({ kind: 'snapshot-failed', error })
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /** 收到一批增量（已判定接得上）。 */
  function receive(events) {
    if (!Array.isArray(events) || events.length === 0) return
    const last = events[events.length - 1]
    // 应用之后，「下一个期望号」= 最后一条 + 1（**不是「最后一条」**）。
    if (last !== undefined) nextSeq = last.seq + 1
    // 每条事件都是一次权威时间校准。
    syncBaseMs = performance.now()
    options.onEvents?.(events)
    emitState()
  }

  /** 连事件流。断线由 EventSource 自己重连，服务端按 Last-Event-ID 补发。 */
  function start() {
    if (stopped) return null
    source = new EventSource(eventsApi)

    source.onopen = () => {
      connected = true
      lastMessageMs = performance.now()
      emitState()
    }

    source.onerror = () => {
      // 不在这里重连：EventSource 自己会，而且**它会带上 Last-Event-ID**，
      // 服务端据此补发断线期间的事件。自己再写一套重连只会和它打架。
      connected = false
      emitState()
    }

    source.onmessage = (frame) => {
      lastMessageMs = performance.now()
      let message
      try {
        message = JSON.parse(frame.data)
      } catch {
        return
      }
      options.onMessage?.(message)

      if (message.type === 'events') {
        const first = message.events?.[0]
        // **gap 自愈的客户端一半**：判定逻辑在 `decideOnBatch` 里（纯函数、有测试）。
        // 重点是**倒退也算断裂**——重开一局时 seq 从头开始，
        // 只看"是否跳过了一段"会漏掉这种情况，于是新世界的事件被叠到旧世界上，
        // 而画面上只是一堆对不上的状态，不会报任何错。
        if (first !== undefined && decideOnBatch(first.seq, nextSeq) === 'resync') {
          // **节流**：即使语义正确，异常情况下（服务端反复重开、或内容真的对不上）
          // 也不能形成「每批事件重拉一次」的请求风暴。合并到最多每秒一次。
          const now = performance.now()
          if (now - lastResyncMs >= resyncMinGapMs) {
            lastResyncMs = now
            void reload()
          }
          return
        }
        receive(message.events ?? [])
        return
      }

      if (message.type === 'sync') {
        // 权威时间。校准基准，让本地时钟在两次事件之间自己往前走。
        const now = performance.now()
        // R108：**实测心跳节奏**（服务端没在 `hello` 里报时的兜底）。
        // 只记"最长间隔"而不是平均：网络抖动会让某一次特别长，用最大值才不会误判。
        if (lastSyncAtMs > 0) observedSyncGapMs = Math.max(observedSyncGapMs, now - lastSyncAtMs)
        lastSyncAtMs = now
        syncBaseMs = now
        connected = true
        options.onSync?.(message)
        emitState()
        return
      }

      if (message.type === 'reset') {
        // 服务端明说"补不齐"（那段历史已经滚出环形缓冲）。
        options.onReset?.()
        void reload()
        return
      }

      if (message.type === 'hello') {
        // 同理：`hello.seq` 是「下一个要分配的号」，不是「最后一条」。
        if (typeof message.seq === 'number') nextSeq = message.seq
        // R108：服务端可以在这里报自己的心跳间隔，客户端据此定"过期"阈值。
        // 没报也不要紧——下面会用实测值兜底（所以这条不阻塞任何东西）。
        if (Number.isFinite(message.heartbeatMs) && message.heartbeatMs > 0) heartbeatHintMs = message.heartbeatMs
        emitState()
      }
    }

    return source
  }

  return {
    start,
    reload,
    stop() {
      stopped = true
      source?.close()
      source = null
      connected = false
      emitState()
    },
    status: () => ({ connected, nextSeq, lastMessageMs, syncBaseMs }),
    /**
     * 本地时钟的"滑走"部分：两次权威时间之间，世界自己往前走了多少步。
     *
     * 世界 tick 由调用方加：`world.tick + slippedTicks(tickMs)`。
     * 没有变更事件的那些步**不会产生任何事件**（没人动就没有帧事件、没人在干活就没有进度事件），
     * 所以本地必须自己往前走，否则时钟会一顿一顿。
     */
    slippedTicks(tickMs) {
      const span = Number.isFinite(tickMs) && tickMs > 0 ? tickMs : 100
      return Math.floor(Math.max(0, performance.now() - syncBaseMs) / span)
    },
    /** 多久没收到任何消息了（含心跳）。数据旧了必须说出来。 */
    silentForMs: () => performance.now() - lastMessageMs,
    /**
     * 多久没消息才算"事件流卡住"（R108）。
     *
     * **调用方必须用这个，不要自己写常数**：它按服务端的实际心跳节奏算出来，
     * 而"阈值比心跳短"正是 R108 那个假警报的根因。
     */
    staleAfterMs,
    /** 诊断用：心跳节奏是从哪来的、值多少（验收时要能说清判据）。 */
    heartbeat: () => ({
      hintMs: heartbeatHintMs,
      observedGapMs: observedSyncGapMs,
      staleAfterMs: staleAfterMs(),
    }),
  }
}
