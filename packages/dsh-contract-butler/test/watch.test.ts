/**
 * 监视器测试：确认"文件变了会被发现、并且合成一批"。
 *
 * 这里只测到"产出了一批路径"为止——去抖与排除逻辑属于监视器，重扫与判定属于演化模块，
 * 两者分开测，出问题时才定位得准。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { watchProject } from '../lib/watch.js'

/** 等一会儿。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'butler-watch-'))
}

test('监视：新建文件会被发现，并且以相对路径上报', async () => {
  const root = tempDir()
  const batches: string[][] = []
  const watcher = watchProject({
    root,
    excludeDirs: ['node_modules'],
    debounceMs: 50,
    handlers: { onBatch: (files) => batches.push(files) },
  })
  try {
    // 监视器建立到真正收事件之间有一小段启动期（FSEvents 尤其明显），紧接着写文件可能丢事件。
    // 现实里没问题——启动时的现状由首次扫描覆盖，这里等一下只是让测试不抖。
    await sleep(150)
    fs.writeFileSync(path.join(root, 'a.json'), '{}')
    await sleep(900)
  } finally {
    watcher.close()
  }
  assert.ok(batches.length >= 1, '应当至少产出一批变化')
  const all = batches.flat()
  assert.ok(all.includes('a.json'), `期望看到 a.json，实际 ${all.join(', ')}`)
  assert.ok(!all.some((item) => item.startsWith('/')), '上报的应当是相对路径')
})

test('监视：排除目录里的变化不上报', async () => {
  const root = tempDir()
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  const batches: string[][] = []
  const watcher = watchProject({
    root,
    excludeDirs: ['node_modules'],
    debounceMs: 50,
    handlers: { onBatch: (files) => batches.push(files) },
  })
  try {
    await sleep(150)
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x')
    await sleep(900)
  } finally {
    watcher.close()
  }
  const all = batches.flat()
  assert.ok(
    !all.some((item) => item.includes('node_modules')),
    `排除目录不该上报，实际 ${all.join(', ')}`,
  )
})

test('监视：关闭之后不再上报', async () => {
  const root = tempDir()
  const batches: string[][] = []
  const watcher = watchProject({
    root,
    excludeDirs: [],
    debounceMs: 50,
    handlers: { onBatch: (files) => batches.push(files) },
  })
  watcher.close()
  fs.writeFileSync(path.join(root, 'late.json'), '{}')
  await sleep(400)
  assert.deepEqual(batches, [])
})

test('监视：不存在的目录不会抛错（只是没得看）', () => {
  const root = path.join(tempDir(), 'missing')
  assert.doesNotThrow(() => {
    const watcher = watchProject({
      root,
      excludeDirs: [],
      debounceMs: 50,
      handlers: { onBatch: () => undefined, onError: () => undefined },
    })
    watcher.close()
  })
})
