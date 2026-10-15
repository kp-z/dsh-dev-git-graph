/*
 * 增量应用（M3-6）——**纯函数，不碰 DOM**。
 *
 * 它单独一个文件不是为了好看，是为了**能被 node 测**：面板从轮询改成增量推送之后，
 * "事件够不够重建画面"这件事没有任何肉眼可查的手段。放进一个纯模块里，
 * 就能写"从 tick 0 的快照出发、把 N 步的事件全部应用、再和真实世界比"这种测试。
 *
 * 判据（写在 `src/sim/patches.ts` 里）：**面板从快照里读的字段，增量里也必须能拿到**。
 * 少一个的症状很难归因——比如完工事件不带 station，人就会永远坐在那张桌子上，
 * 而看起来像"渲染层没刷新"。
 */

/** 按 id 找角色。 */
function agentOf(world, id) {
  return world.agents.find((a) => a.id === id)
}

/** 按 id 找工单。 */
function taskOf(world, id) {
  return world.tasks.find((t) => t.id === id)
}

/**
 * 应用一批事件到本地世界（就地修改）。
 *
 * @param {object} world - 本地世界（来自快照，之后只靠增量维护）。
 * @param {ReadonlyArray<object>} events - 事件批。
 * @returns {object} 同一个 world
 */
export function applyEvents(world, events) {
  for (const event of events) applyEvent(world, event)
  return world
}

/** 应用一条事件。 */
export function applyEvent(world, event) {
  const payload = event?.payload ?? {}

  // 世界时间：**变更事件**是在第 `e.tick` 步**之中**产生的，而 `world.tick` 在那一步末尾
  // 才自增，所以走完这一步之后世界是 `e.tick + 1`。不变更的 `sync` 例外——它报的是
  // "世界现在走到哪"，本来就 +1 过了，再 +1 会让时钟每次都多跑一步。
  if (event.type !== 'sync' && typeof event.tick === 'number') {
    world.tick = Math.max(world.tick, event.tick + 1)
  }

  switch (event.type) {
    case 'world.tick': {
      // 元组数组：`[id, x, z, facing]`。**只带真的有位移的人**，不是全量位置。
      const rows = Array.isArray(payload.agents) ? payload.agents : []
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 4) continue
        const [id, x, z, facing] = row
        const agent = agentOf(world, id)
        if (agent === undefined) continue
        agent.position = { x, z }
        agent.facing = facing
      }
      return
    }

    case 'agent.state': {
      const agent = agentOf(world, payload.id)
      if (agent === undefined) return
      // 载荷里带了变更后的当前值（见 patches.ts），所以这里是**直接赋值**而不是猜。
      if (typeof payload.state === 'string') agent.state = payload.state
      if ('station' in payload) agent.station = payload.station
      if ('targetStation' in payload) agent.targetStation = payload.targetStation
      if ('carrying' in payload) agent.carrying = payload.carrying
      if (typeof payload.facing === 'number') agent.facing = payload.facing
      return
    }

    case 'task.changed': {
      let task = taskOf(world, payload.id)
      if (task === undefined) {
        // 新派进来的工单：事件里带全了画板子需要的字段，所以能就地建出来。
        // 建不出来的话（比如缺 title），这里会抛——**宁可报错也不要静默少一张单**。
        if (typeof payload.title !== 'string' || typeof payload.ordinal !== 'number') {
          throw new Error(
            `收到一条新工单的事件，但载荷不足以建出它：${JSON.stringify(payload)}。` +
              '这是协议缺陷——事件必须带齐客户端显示所需的字段。',
          )
        }
        task = { id: payload.id, key: payload.key ?? payload.id, title: payload.title, ordinal: payload.ordinal, progress: 0, owner: null, station: null, blockedBy: [] }
        world.tasks.push(task)
      }
      if (typeof payload.status === 'string') task.status = payload.status
      if (typeof payload.progress === 'number') task.progress = payload.progress
      if ('owner' in payload) task.owner = payload.owner
      if ('station' in payload) task.station = payload.station
      if (typeof payload.estimateTicks === 'number') task.estimateTicks = payload.estimateTicks
      return
    }

    case 'message.sent': {
      if (world.messages.some((m) => m.id === payload.id)) return
      world.messages.push({
        id: payload.id,
        from: payload.from,
        to: payload.to,
        kind: payload.kind ?? 'report',
        atTick: event.tick,
        deliveredAtTick: null,
        // 服务端在"开始飞"的那一刻就把送达时刻给了，所以客户端不用自己抄投递延迟。
        deliverAtTick: typeof payload.deliverAtTick === 'number' ? payload.deliverAtTick : event.tick,
      })
      return
    }

    case 'sync': {
      // 权威时间。**刻意不 +1**：同步帧报的是"世界已经走到哪"，不是"某一步之内"。
      // 客户端在两次同步之间靠本地时钟（wall time / tickMs）自己往前走，
      // 所以这里只做**校准**，不做推进。
      if (typeof payload.tick === 'number') world.tick = Math.max(world.tick, payload.tick)
      if (payload.seq !== undefined) world.seq = payload.seq
      if (typeof payload.paused === 'boolean') world.paused = payload.paused
      return
    }

    case 'world.paused': {
      if (typeof payload.paused === 'boolean') world.paused = payload.paused
      return
    }

    default:
      // 不认识的类型**不报错**：协议要能向前加事件类型而不弄坏老客户端。
      return
  }
}

/** 清掉已经落地的纸条（模拟服务端的邮箱裁剪，免得本地无限增长）。 */
export function pruneMessages(world, keep = 200) {
  const flying = world.messages.filter((m) => world.tick < (m.deliverAtTick ?? world.tick))
  const landed = world.messages.filter((m) => world.tick >= (m.deliverAtTick ?? world.tick))
  world.messages = [...landed.slice(-keep), ...flying]
  return world
}

/**
 * 收到一批增量时该「应用」还是「重新拉快照」。
 *
 * ## 语义（R21 修过一次，这里写死）
 *
 * `nextSeq` 是「**下一个期望的事件序号**」，不是「已经消费的最后一个序号」。
 * 这个区别是**一个真 bug 的根因**：`world.seq` 在协议里的含义是「下一个要分配的号」，
 * 而面板原来把它当「最后消费的号」，于是
 *
 *     快照 seq = N  →  lastSeq = N          （把它当成「已经到 N 了」）
 *     下一条事件    →  seq = N              （它其实是「分配给 N」）
 *     decideOnBatch(N, N) → N <= N → resync  ✗ 每来一批就重拉一次快照
 *
 * 后果不是画面错（快照是新的，看起来完全正常），而是**每秒约 10 次快照请求 +
 * 每次重建场景泄漏约 6 个 GPU 纹理**——量了才知道。所以这里统一成「下一个期望号」：
 * 快照的 `seq`、`hello.seq`、以及「上一批最后一条 + 1」三者含义一致。
 *
 * ## 三种情况
 *
 * - `firstSeq === nextSeq`：严丝合缝，应用；
 * - `firstSeq > nextSeq`：中间缺了（服务端重启过、或我们漏了一批）→ 重拉；
 * - `firstSeq < nextSeq`：**倒退或重复**。最典型的来源是**重开一局**（seq 从头开始），
 *   也可能是服务端重放了我们已经有的。两种都不能「跳过重复的继续应用」——
 *   重开一局时那些 seq 看起来「重复」，但它们属于**另一个世界**。
 *
 * @param {number} firstSeq - 这批事件的第一条 seq。
 * @param {number} nextSeq - 本地**下一个期望**的 seq。
 * @returns {'apply' | 'resync'}
 */
export function decideOnBatch(firstSeq, nextSeq) {
  if (!Number.isFinite(firstSeq)) return 'apply' // 空批/异常批：交给上层当无事发生
  return firstSeq === nextSeq ? 'apply' : 'resync'
}

