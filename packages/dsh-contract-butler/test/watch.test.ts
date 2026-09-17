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

test('监视：递归监视不可用时真的会轮询，而不是只把一个标志位立起来', async () => {
  // 根目录先不存在：fs.watch 会抛错，从而走轮询兜底。这是唯一能在测试里可靠逼出兜底路径的办法。
  const root = path.join(os.tmpdir(), `butler-poll-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const batches: string[][] = []
  const watcher = watchProject({
    root,
    excludeDirs: ['node_modules'],
    pollMs: 40,
    handlers: { onBatch: (files) => batches.push(files), onError: () => undefined },
  })
  assert.equal(watcher.polling, true, '递归监视失败后应当已经退回轮询')

  // 第一轮轮询只建立基线：它证明不了"之前错过什么"，所以不该凭空报一批。
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'a.proto'), 'syntax = "proto3";\nmessage A { string a = 1; }\n')
  await sleep(220)
  const baselined = batches.length

  // 然后真的改一次：轮询必须发现它。
  fs.writeFileSync(path.join(root, 'a.proto'), 'syntax = "proto3";\nmessage A { string a = 1; string b = 2; }\n')
  await sleep(220)
  watcher.close()

  assert.ok(batches.length > baselined, '改了文件之后轮询应当报出一批')
  const reported = batches.slice(baselined).flat()
  assert.ok(reported.includes('a.proto'), `应当报出 a.proto，实际 ${JSON.stringify(reported)}`)
})

test('监视：轮询也遵守排除目录，不会为产物目录空转', async () => {
  const root = path.join(os.tmpdir(), `butler-poll-x-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const batches: string[][] = []
  const watcher = watchProject({
    root,
    excludeDirs: ['node_modules'],
    pollMs: 40,
    handlers: { onBatch: (files) => batches.push(files), onError: () => undefined },
  })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(root, 'good.proto'), 'syntax = "proto3";\nmessage G { string g = 1; }\n')
  await sleep(200) // 建立基线

  // 同时动一个该看的、一个不该看的：只断言"没报排除目录"在什么都没报时也会成立，
  // 所以必须同时证明该看的那个确实被发现了。
  fs.writeFileSync(path.join(root, 'good.proto'), 'syntax = "proto3";\nmessage G { string g = 1; string h = 2; }\n')
  fs.writeFileSync(path.join(root, 'node_modules', 'noise.proto'), 'syntax = "proto3";\nmessage N { string n = 1; }\n')
  await sleep(240)
  watcher.close()

  const reported = batches.flat()
  assert.ok(reported.includes('good.proto'), `该看的文件必须被报出来：${JSON.stringify(reported)}`)
  assert.ok(
    !reported.some((file) => file.includes('node_modules')),
    `不该报出排除目录里的文件：${JSON.stringify(reported)}`,
  )
})

test('监视：关了之后轮询也停，不再报批', async () => {
  const root = path.join(os.tmpdir(), `butler-poll-c-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const batches: string[][] = []
  const watcher = watchProject({
    root,
    excludeDirs: [],
    pollMs: 40,
    handlers: { onBatch: (files) => batches.push(files), onError: () => undefined },
  })
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'a.proto')
  fs.writeFileSync(file, 'syntax = "proto3";\nmessage A { string a = 1; }\n')
  await sleep(200) // 建立基线

  // 先证明它在报：否则"关掉之后没再报"什么也证明不了。
  fs.writeFileSync(file, 'syntax = "proto3";\nmessage A { string a = 1; string b = 2; }\n')
  await sleep(240)
  const beforeClose = batches.length
  assert.ok(beforeClose > 0, '关闭之前应当确实在报批次')

  watcher.close()
  fs.writeFileSync(file, 'syntax = "proto3";\nmessage A { string a = 1; string b = 2; string c = 3; }\n')
  await sleep(260)
  assert.equal(batches.length, beforeClose, '关掉之后不该再有新的批次')
})
