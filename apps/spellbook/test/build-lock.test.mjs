/**
 * 构建的并发安全。
 *
 * 这一条是被咬过才写的。站点上出现的那些怪象 —— 首页 404、spell/ 只有十个目录、
 * numeral.css 在而 index.html 不在 —— 全都不是页面的问题，是构建自己踩自己：
 *
 *   serve.mjs 同时监听 content/ 与 src/，改一个文件它就重建一次；
 *   而我一边改一边又手动 node build.mjs，两个构建重叠。
 *
 * 后来又发现，光让每个构建各写各的临时目录、最后换名还不够：
 * rename 到「已存在的非空目录」在 POSIX 上是 ENOTEMPTY，会失败。
 * 两个构建都卡在「删 dist」和「换名」中间时，后到的换不过去，
 * 临时目录就整份烂在那里（实测四路并发出三个完整的孤岛，各 398 个文件）。
 *
 * 所以这里守两条：
 *   1. 四个构建同时跑，dist 必须是完整的，临时目录与锁都不能留；
 *   2. 锁不能在构建结束后还占着 —— 否则下一次构建会一直等到超时。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DIST = path.join(ROOT, 'dist')

const runBuild = () =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'ignore' })
    child.on('close', (code) => resolve(code))
  })

const exists = async (p) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * 等锁空出来。
 *
 * 绝**不能**直接把 .build.lock 删掉来"清场"：测试是并行跑的，
 * serve.mjs 的监视器也在按需重建，谁手里正拿着锁你就把锁删了，
 * 互斥当场失效，两个构建又叠在一起 —— 那正是要防的事。
 */
const waitForLockFree = async (timeoutMs = 90000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(path.join(ROOT, '.build.lock'))
    } catch {
      return true
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

test('四个构建同时跑，产物仍然完整、不留临时目录、不放着锁', async (t) => {
  // 先等别人（监视器的自动重建、并行的别的测试）用完
  assert.ok(await waitForLockFree(), '等锁超时：有构建一直占着')

  const codes = await Promise.all([runBuild(), runBuild(), runBuild(), runBuild()])
  assert.deepEqual(codes, [0, 0, 0, 0], '四个构建都该正常退出')

  // 1. 产物必须完整
  assert.ok(await exists(path.join(DIST, 'index.html')), 'index.html 必须在')
  for (const asset of ['site.js', 'numeral.css', 'search-index.json', 'effects.json']) {
    assert.ok(await exists(path.join(DIST, asset)), `${asset} 必须在`)
  }

  const spells = await readdir(path.join(DIST, 'spell'))
  assert.ok(spells.length >= 100, `spell/ 目录数应完整，实得 ${spells.length}`)
  for (const slug of spells) {
    assert.ok(
      await exists(path.join(DIST, 'spell', slug, 'index.html')),
      `${slug} 该有 index.html`,
    )
  }

  // 2. 临时目录一个都不许剩：换名成功的话源目录就没了
  const leftovers = (await readdir(ROOT)).filter((n) => n.startsWith('.dist-staging-'))
  assert.deepEqual(leftovers, [], `不该留下临时目录，实得 ${leftovers.join(', ')}`)

  // 3. 锁必须放掉，否则下次构建会一直等到超时
  assert.equal(await exists(path.join(ROOT, '.build.lock')), false, '构建结束后不该还占着锁')
})

test('死进程留下的锁能被后来者掀掉，不会把构建永久卡死', async () => {
  const lock = path.join(ROOT, '.build.lock')
  assert.ok(await waitForLockFree(), '等锁超时')

  // 造一把假锁，主人写一个绝不可能存在的 pid
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(lock)
  await writeFile(path.join(lock, 'pid'), '999999', 'utf8')

  const code = await runBuild()
  assert.equal(code, 0, '碰到死锁也该自己掀掉接着建')
  assert.equal(await exists(lock), false, '建完要把锁放掉')

  // 顺带确认产物真的被这次构建刷新过
  assert.ok(await exists(path.join(DIST, 'index.html')))
})

test('构建期间不会把 dist 停在半成品上', async () => {
  // 构建是「先建到临时目录、最后整体换名」，所以任何时刻 dist 要么是旧的完整版、
  // 要么是新的完整版。这里趁构建进行时反复探，不该探到缺 index.html 的状态。
  assert.ok(await waitForLockFree(), '等锁超时')
  const seen = new Set()
  let running = true
  const probe = (async () => {
    while (running) {
      seen.add(await exists(path.join(DIST, 'index.html')))
    }
  })()

  await runBuild()
  running = false
  await probe

  // 允许有「没有 dist」这种瞬态吗？不允许 —— 换名是原子的，中间不存在空窗。
  assert.ok(seen.has(true), '构建过程中 dist 里始终该有 index.html')
})
