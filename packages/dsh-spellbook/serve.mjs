/**
 * 咒语书 —— 开发服务器
 *
 *   node serve.mjs [--port 5180] [--no-watch]
 *
 * 静态服务 dist/，并监听 content/ 与 src/，改动后自动重建。
 * 只用于本地开发；线上就是 dist/ 里那堆静态文件。
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync, watch } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')

const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const startPort = portArg !== -1 ? Number(args[portArg + 1]) : 5180
const watchMode = !args.includes('--no-watch')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

function rebuild() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'inherit' })
    child.on('exit', resolve)
  })
}

// 重建串行化：并发写 dist 会互相踩，改动密集时只补跑一轮
let building = false
let pending = false

async function rebuildQueued() {
  if (building) {
    pending = true
    return
  }
  building = true
  do {
    pending = false
    await rebuild()
  } while (pending)
  building = false
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  const target = path.join(DIST, clean)

  // 不许跳出 dist
  if (target !== DIST && !target.startsWith(DIST + path.sep)) return null

  if (await isDirectory(target)) {
    const index = path.join(target, 'index.html')
    return existsSync(index) ? index : null
  }
  if (existsSync(target)) return target

  const withIndex = path.join(target, 'index.html')
  if (existsSync(withIndex)) return withIndex

  return null
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? '/')

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<h1>404</h1><p>没有这一页。<a href="/">回目录</a>。</p>')
    return
  }

  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(error))
  }
})

function listen(port) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') listen(port + 1)
    else throw error
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`咒语书：http://127.0.0.1:${port}/`)
  })
}

await rebuild()

if (watchMode) {
  let timer = null
  // 编辑器保存时会先写 .xxx.tmpdir 之类的临时文件，
  // 不过滤的话一次保存会触发两轮重建
  const TRANSIENT = /(^|[/\\])\.|\.tmpdir$|~$|\.swp$/

  const trigger = (event, filename) => {
    if (!filename || filename.startsWith('dist') || TRANSIENT.test(filename)) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      console.log(`\n↻ ${filename} 变了，重建…`)
      await rebuildQueued()
    }, 120)
  }
  watch(path.join(ROOT, 'content'), { recursive: true }, trigger)
  watch(path.join(ROOT, 'src'), { recursive: true }, trigger)
}

listen(startPort)
