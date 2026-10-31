/** Same-origin, read-only SSE fanout. No task mutation, Feishu IO or agent activation. */
import { randomUUID } from 'node:crypto'
export function createActivityFeed(readSessions) {
  const generation = randomUUID()
  const clients = new Set()
  let revision = 0, queued = false, disposed = false
  const packet = () => ({ generation, revision, sessions: readSessions() })
  function send(client) {
    if (client.res.destroyed || client.res.writableEnded) return client.close()
    // A blocked consumer reconnects to a fresh baseline rather than accumulating frames.
    if (client.res.writableLength > 64 * 1024) { client.close(); client.res.end(); return }
    try { client.res.write('event: activity\ndata: ' + JSON.stringify(packet()) + '\n\n') }
    catch { client.close() }
  }
  return {
    changed() {
      if (disposed || queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (disposed) return
        revision++
        for (const client of clients) send(client)
      })
    },
    open(req, res) {
      if (disposed) { res.writeHead(503); res.end(); return }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
      res.flushHeaders?.()
      const client = { res, close() { clients.delete(client); clearInterval(client.timer); res.off('close', client.close) } }
      clients.add(client)
      res.on('close', client.close)
      client.timer = setInterval(() => {
        if (res.destroyed || res.writableEnded) return client.close()
        if (res.writableLength > 64 * 1024) { client.close(); res.end(); return }
        try { res.write(': heartbeat\n\n') } catch { client.close() }
      }, 15000)
      client.timer.unref?.()
      send(client)
    },
    dispose() { disposed = true; for (const client of [...clients]) { client.close(); client.res.end() } },
  }
}
