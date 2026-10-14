/**
 * SSE 事件流（BACKLOG M3-4）。
 *
 * `GET /api/events` —— 一条长连接，服务端主动把事件推下去。
 *
 * ## 为什么要有它（而不是继续轮询）
 *
 * 面板原来每 400ms 拉一次**全量快照**。世界里 24 个角色时那是一个几十 KB 的响应，
 * 而其中 99% 的内容和上一帧一样。SSE 只推变化，而且延迟从"最多 400ms"降到"下一个事件批"。
 *
 * ## 三件必须自己做的事
 *
 * 1. **`id:` 要带 `seq`**。浏览器断线重连时会自动带上 `Last-Event-ID`，
 *    服务端据此补发断线期间的事件——这就是"gap 自愈"的服务端一半
 *    （客户端那一半是 `hasSeqGap`，已经写好并有测试）。
 * 2. **慢客户端要断开，不能缓冲**。`res.write` 返回 false 说明内核缓冲满了；
 *    继续写就是让内存随一个卡住的浏览器无限增长。这时候**主动断开**并说明原因，
 *    让浏览器自己重连——重连会带来一次 `Last-Event-ID` 补发，比悄悄吃内存好得多。
 *    这也是为什么广播层的 `publish` 可以是同步的（见 `runtime/hub.ts`）。
 * 3. **心跳**。世界暂停时就没有事件了，而长连接在这些情况下会被中间层掐掉：
 *    定期发一个注释行（`: ping`）保持连接。注释行不会被解析成消息。
 */
import type http from 'node:http'
import type { RouteEntry } from './router.js'
import { HttpError } from './router.js'
import type { EventSourcePort, WorldServicePort } from '../protocol/index.js'
import { PROTOCOL_VERSION } from '../protocol/index.js'

/** 建 SSE 路由需要的依赖。 */
export interface EventsDeps {
  source: EventSourcePort
  service: WorldServicePort
  /** 心跳间隔（ms）。默认 15 秒。 */
  heartbeatMs?: number
}

/** 一帧 SSE 的文本。 */
export function sseFrame(data: unknown, id?: number): string {
  const lines: string[] = []
  if (id !== undefined) lines.push(`id: ${id}`)
  // data 里不能有裸换行：SSE 的 data 是逐行拼的，JSON.stringify 不会产生换行，
  // 但仍显式保证一次 write 一帧、以空行结束。
  lines.push(`data: ${JSON.stringify(data)}`)
  return lines.join('\n') + '\n\n'
}

/** 一帧注释（心跳）。 */
export function sseComment(text: string): string {
  return `: ${text}\n\n`
}

/**
 * 造 SSE 路由。
 *
 * `Last-Event-ID` 的处理是本文件里最值得看的一段：
 * - 客户端给的 seq **还在环形缓冲里** → 补发缺的那些（真正的增量续传）；
 * - 给的 seq **太旧、已经滚出缓冲** → 补不了。这时**不假装能补**，
 *   而是发一条 `reset` 让客户端重新拉快照。假装能补的后果是客户端静默丢失一段历史。
 */
export function eventsRoutes(deps: EventsDeps): RouteEntry[] {
  const heartbeatMs = deps.heartbeatMs ?? 15_000

  return [
    {
      method: 'GET',
      pattern: '/api/events',
      handler: ({ req, res }) => {
        const world = deps.service.currentWorld()
        if (world === null) {
          throw new HttpError(503, '世界还没建出来，没有事件可推。')
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          // 让 nginx 之类的反代不要缓冲——缓冲会把"实时"变成"攒够一批才吐"。
          'X-Accel-Buffering': 'no',
        })
        // 握手：告诉客户端当前 seq 与重连间隔。客户端据此判断自己是不是落后了。
        res.write(sseComment(`agent-world v${PROTOCOL_VERSION}`))
        res.write(sseFrame({ v: PROTOCOL_VERSION, type: 'hello', seq: world.seq }))
        res.write(`retry: 3000\n\n`)

        // ── gap 自愈的服务端一半 ──
        const lastEventId = req.headers['last-event-id']
        const since = typeof lastEventId === 'string' ? Number.parseInt(lastEventId, 10) : Number.NaN
        if (Number.isFinite(since)) {
          const buffered = world.events
          const oldest = buffered.length > 0 ? (buffered[0]?.seq ?? 0) : world.seq
          if (since >= world.seq) {
            // 客户端不比我们旧（重放/乱序），什么都不用补。
          } else if (buffered.length > 0 && since >= oldest - 1) {
            const missing = buffered.filter((e) => e.seq > since)
            if (missing.length > 0) {
              const last = missing[missing.length - 1]
              res.write(
                sseFrame(
                  { v: PROTOCOL_VERSION, type: 'events', events: missing },
                  last === undefined ? undefined : last.seq,
                ),
              )
            }
          } else {
            // 太旧，补不了。**明说**，别让客户端以为自己是连续的。
            res.write(
              sseFrame({
                v: PROTOCOL_VERSION,
                type: 'reset',
                seq: world.seq,
                reason: `请求从 seq ${since} 续传，但事件环形缓冲只留最近 ${buffered.length} 条（最旧 ${oldest}）——补不齐，请重新拉一次快照。`,
              }),
            )
          }
        }

        let closed = false
        const unsubscribe = deps.source.subscribe((events) => {
          if (closed || events.length === 0) return
          const last = events[events.length - 1]
          const ok = res.write(
            sseFrame({ v: PROTOCOL_VERSION, type: 'events', events }, last === undefined ? undefined : last.seq),
          )
          if (!ok) {
            // 内核缓冲满了 = 这个客户端跟不上。**断开**，让它重连后用 Last-Event-ID 补发。
            // 继续写就是让内存随一个卡住的浏览器无限增长。
            closed = true
            unsubscribe()
            clearInterval(heartbeat)
            res.write(sseComment('客户端读得太慢，已断开；重连后会自动补发断线期间的事件。'))
            res.end()
          }
        })

        // 心跳**不只是保活，还是时钟校准**。
        //
        // 为什么必须有：世界静止时没有任何变更事件（没有位移就没有帧事件、没人在干活就没有
        // 进度事件），于是客户端的 `world.tick` 会停在原地——而它要用这个 tick 算"纸条飞到哪了"。
        // 900 步的实测里客户端会落后 32%，UI 上就是"世界明明在跑，时间却不动"。
        //
        // 修法有两种：每 tick 都发一条帧事件（事件量从 0.33/步 涨到 1/步，一天多几十 MB 日志），
        // 或者**让心跳顺带报一次权威时间**。选后者：代价是每次心跳一条，与世界的快慢无关。
        const heartbeat = setInterval(() => {
          if (closed) return
          res.write(sseComment('ping')) // 注释行给中间层看（有些反代只认"有字节流动"）
          const current = deps.service.currentWorld()
          if (current === null) return
          res.write(
            sseFrame({
              v: PROTOCOL_VERSION,
              type: 'sync',
              tick: current.tick,
              seq: current.seq,
              paused: current.paused,
            }),
          )
        }, heartbeatMs)

        const finish = (): void => {
          if (closed) return
          closed = true
          unsubscribe()
          clearInterval(heartbeat)
        }
        // **必须挂清理**：不摘订阅的话，热重载会泄漏订阅者，
        // 而症状是"每改一次代码，模拟循环要推的客户端多一个"。这和 R7 的定时器泄漏同类。
        req.on('close', finish)
        res.on('close', finish)
        res.on('error', finish)

        // 返回 undefined = "响应我已经接管了"，路由层不会再序列化 JSON。
        return undefined
      },
    },
  ]
}
