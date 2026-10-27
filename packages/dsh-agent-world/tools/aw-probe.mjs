#!/usr/bin/env node
/**
 * R412：Agent World live 探针（CDP）。
 *
 * 用 Chrome 打开页面，等场景加载后执行一段 JS，把 occlusion / trace / 动画等读数
 * 以 JSON 打到 stdout。这样 y 排序、运动、动作不需要靠肉眼看截图。
 *
 * 用法：
 *   node tools/aw-probe.mjs --url 'http://.../agent-world/?debug=1&token=...' --wait 5000
 *   node tools/aw-probe.mjs --url ... --expr 'JSON.stringify(globalThis.__agentWorldPhaser.occlusionAudit())'
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

function parse(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue }
    out[key] = next
    i += 1
  }
  return out
}
const args = parse(process.argv.slice(2))
const url = args.url
const wait = Math.max(1000, Number(args.wait) || 5000)
const expression = typeof args.expr === 'string' && args.expr !== ''
  ? args.expr
  : `JSON.stringify({
      occlusion: globalThis.__agentWorldPhaser?.occlusionAudit?.(),
      chairs: globalThis.__agentWorldPhaser?.chairAudit?.(),
      trace: globalThis.__agentWorldScene2d?.actorTrace?.(),
      manual: globalThis.__agentWorldScene2d?.manualState?.(),
      stats: globalThis.__agentWorldScene2d?.stats?.(),
    })`
if (typeof url !== 'string' || url === '') { console.error('需要 --url'); process.exit(1) }
const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((value) => typeof value === 'string' && value !== '' && existsSync(value))
if (candidates.length === 0) { console.error('找不到 Chrome/Chromium；设置 CHROME_PATH'); process.exit(1) }
const port = 9500 + Math.floor(Math.random() * 400)
const profile = `/tmp/aw-probe-${process.pid}`
const chrome = spawn(candidates[0], [
  '--headless=old', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--disable-component-update', '--disable-background-networking',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function getJson(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: path.startsWith('/json/new') ? 'PUT' : 'GET' })
  if (!response.ok) throw new Error(`CDP ${path} HTTP ${response.status}`)
  return response.json()
}
let ws
try {
  let version = null
  for (let i = 0; i < 80 && version === null; i += 1) {
    try { version = await getJson('/json/version') } catch { await sleep(150) }
  }
  if (version === null) throw new Error('Chrome 调试端口没有起来')
  const target = await getJson(`/json/new?${encodeURIComponent('about:blank')}`)
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id === undefined) return
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url })
  await sleep(wait)
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text ?? 'evaluate failed')
  const raw = result.result?.value
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (args.check === true) {
    const issues = []
    if (value?.occlusion?.ok !== true) issues.push('occlusion 审计未通过')
    if ((value?.occlusion?.anomalyCount ?? 0) > 0) issues.push(`occlusion ${value.occlusion.anomalyCount} 个异常`)
    if ((value?.occlusion?.pairAnomalyCount ?? 0) > 0) issues.push(`pair occlusion ${value.occlusion.pairAnomalyCount} 个异常`)
    if ((value?.chairs?.duplicates?.length ?? 0) > 0) issues.push(`椅子重复 ${value.chairs.duplicates.length}`)
    if ((value?.stats?.actorFallbacks ?? 0) > 0) issues.push(`actor fallback ${value.stats.actorFallbacks}`)
    for (const actor of value?.trace ?? []) {
      if (actor.texture === null || actor.textureKey === null) issues.push(`${actor.id}: 无贴图`)
      if (actor.anim === null) issues.push(`${actor.id}: 无动画`)
      if (actor.anim !== null && actor.anim.includes('walk-') !== true && actor.target !== null && (actor.target.x !== actor.x || actor.target.y !== actor.y)) {
        issues.push(`${actor.id}: 有目标但播的不是 walk 动画（${actor.anim}）`)
      }
      if (actor.anim !== null && actor.anim.includes('walk-') === true && actor.target !== null && actor.target.x === actor.x && actor.target.y === actor.y) {
        issues.push(`${actor.id}: 已到目标但仍在播 walk`)
      }
      if (['working', 'talking', 'sleeping'].includes(actor.state) === true && ['desk', 'meeting', 'breakroom'].includes(actor.stationKind) === true && actor.seat === null) {
        issues.push(`${actor.id}: ${actor.state}@${actor.stationKind} 没有绑定椅子`)
      }
    }
    if (issues.length > 0) {
      console.error(`scene check: ${issues.length} issues\n  - ${issues.join('\n  - ')}`)
      process.exitCode = 1
    } else {
      console.log('scene check OK')
    }
  } else {
    console.log(typeof raw === 'string' ? raw : JSON.stringify(raw ?? null, null, 2))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  try { ws?.close() } catch {}
  try { chrome.kill('SIGKILL') } catch {}
}
