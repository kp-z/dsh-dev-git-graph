#!/usr/bin/env node
/**
 * R409：Agent World 截图基线（CDP 版本）。
 *
 * old headless 的 `--screenshot` 会在页面还在“连接中”时就按下快门；
 * 这里启动 Chrome 调试端口，导航后等待 `--wait` 毫秒再 `Page.captureScreenshot`。
 * 不依赖 Playwright，只用 Node 内置 WebSocket。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

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
const out = resolve(args.out ?? 'artifacts/agent-world.png')
const width = Math.max(320, Number(args.width) || 1440)
const height = Math.max(240, Number(args.height) || 900)
const wait = Math.max(500, Number(args.wait) || 5000)
if (typeof url !== 'string' || url === '') { console.error('需要 --url'); process.exit(1) }
const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((value) => typeof value === 'string' && value !== '' && existsSync(value))
if (candidates.length === 0) { console.error('找不到 Chrome/Chromium；设置 CHROME_PATH'); process.exit(1) }
mkdirSync(dirname(out), { recursive: true })
const port = 9300 + Math.floor(Math.random() * 500)
const profile = resolve('artifacts/.chrome-profile')
mkdirSync(profile, { recursive: true })
const chrome = spawn(candidates[0], [
  '--headless=old', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--disable-component-update', '--disable-background-networking',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function getJson(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: path.startsWith('/json/new') ? 'PUT' : 'GET' })
  if (!response.ok) throw new Error(`CDP ${path} HTTP ${response.status}`)
  return response.json()
}
async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try { return await getJson('/json/version') } catch { await sleep(150) }
  }
  throw new Error('Chrome 调试端口没有起来')
}

let ws
try {
  await waitForCdp()
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
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await sleep(wait)
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(result.data, 'base64'))
  console.log(out)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  try { ws?.close() } catch {}
  try { chrome.kill('SIGKILL') } catch {}
}
