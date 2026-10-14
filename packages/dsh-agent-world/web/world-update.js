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
 * 收到一批增量时该"应用"还是"重新拉快照"。
 *
 * ## 为什么它值得单独一个函数
 *
 * 这是增量推送里**唯一一处"猜"**：猜自己和服务端还接不接得上。猜错的后果是
 * 把新世界的事件叠到旧世界上（画面上是一堆对不上的状态），而且**不会报错**。
 * 抽出来就能直接测三种情况，而不是靠"看起来对"。
 *
 * 三种情况：
 * - `firstSeq === lastSeq + 1`：严丝合缝，应用；
 * - `firstSeq > lastSeq + 1`：中间缺了（服务端重启过、或者我们漏了一批），**重拉快照**；
 * - `firstSeq <= lastSeq`：**倒退**。最典型的来源是**重开一局**（seq 从头开始），
 *   也可能是服务端重放了我们已经有的。两种都不能"跳过重复的继续应用"——
 *   重开一局时那些 seq 看起来"重复"，但它们属于**另一个世界**。
 *
 * @param {number} firstSeq - 这批事件的第一条 seq。
 * @param {number} lastSeq - 本地已经用掉的最后一条 seq。
 * @returns {'apply' | 'resync'}
 */
export function decideOnBatch(firstSeq, lastSeq) {
  if (!Number.isFinite(firstSeq)) return 'apply' // 空批/异常批：交给上层当无事发生
  if (firstSeq <= lastSeq) return 'resync'
  if (firstSeq > lastSeq + 1) return 'resync'
  return 'apply'
}
