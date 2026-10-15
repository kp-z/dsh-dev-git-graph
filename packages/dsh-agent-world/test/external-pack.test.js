/**
 * 外部内容包测试（BACKLOG M1.5-1 / M1.5-3 / M1.5-5）。
 *
 * 这一组是**"用户改内容就能改世界，不用碰代码"的端到端证明**——
 * 在临时目录里放一个外部包，然后看 `createWorld` 出来的世界真的变了。
 * 没有这条，外部内容包只是"能读文件"，算不上能用。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { apply } from '../lib/index.js'
import { CONTENT_SCHEMA_VERSION, ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { loadContentPacks, resolveContentRoot } from '../lib/content/load-files.js'
import { createWorld } from '../lib/world/create.js'

/**
 * 清理函数的收集器。假 ctx 的 `effect` 必须**像真的一样收集**——立刻执行会让
 * `apply` 的"先挂清理、再启动运行时"变成"先清理、后启动"，定时器随后泄漏，进程不退出。
 */
const collectedDisposers = []
after(() => {
  for (const dispose of collectedDisposers.splice(0)) dispose()
})

/** 建一个临时目录，跑完自动删。 */
function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-world-test-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 同上，但给 async 用（回调里有 await 时 finally 必须等它跑完）。 */
async function withTempDirAsync(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-world-test-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 写一个文件（自动建父目录）。 */
function write(dir, relPath, content) {
  const full = join(dir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8')
  return full
}

/** 一份合法的清单。 */
function manifest(id, extra = {}) {
  return {
    id,
    name: `外部包 ${id}`,
    version: '1.0.0',
    schemaVersion: CONTENT_SCHEMA_VERSION,
    description: '测试用外部包',
    requires: [],
    provides: [],
    overrides: [],
    ...extra,
  }
}

// ── 路径解析 ────────────────────────────────────────────────────────────────

test('resolveContentRoot：空值 → 不加载；绝对路径 → 原样；相对路径 → 相对 cwd', () => {
  assert.deepEqual(resolveContentRoot('', '/work'), { root: null, reason: 'contentDir 未配置，只用内置内容' })
  assert.deepEqual(resolveContentRoot('   ', '/work'), { root: null, reason: 'contentDir 未配置，只用内置内容' })

  const abs = resolveContentRoot('/srv/content', '/work')
  assert.equal(abs.root, '/srv/content')

  const rel = resolveContentRoot('my-content', '/work')
  assert.equal(rel.root, '/work/my-content')
  // 理由要能原样打给用户看——"为什么没读到我的包"第一件事就是看它读了哪个目录。
  assert.match(rel.reason, /\/work/)
})

// ── 目录级问题 ──────────────────────────────────────────────────────────────

test('内容目录不存在 → 警告 + 不加载，但不报错（用户只是还没建）', () => {
  const result = loadContentPacks('/definitely/not/here/agent-world')
  assert.deepEqual(result.packs, [])
  assert.deepEqual(result.issues.map((i) => i.level), ['warning'])
  assert.match(result.issues[0].message, /不存在|跳过/)
})

test('空目录 → 警告（说清子目录应当是什么）', () => {
  withTempDir((dir) => {
    const result = loadContentPacks(dir)
    assert.deepEqual(result.packs, [])
    assert.equal(result.issues.length, 1)
    assert.match(result.issues[0].message, /pack\.json/)
  })
})

test('子目录没有 pack.json → 跳过并警告，不影响其它包', () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, 'random-stuff'))
    write(dir, 'good/pack.json', manifest('pack.good'))

    const result = loadContentPacks(dir)
    assert.deepEqual(result.packs.map((p) => p.manifest.id), ['pack.good'])
    const skip = result.issues.find((i) => i.level === 'warning' && /没有 pack\.json/.test(i.message))
    assert.ok(skip, `应当警告并跳过，得到 ${JSON.stringify(result.issues)}`)
    // 报的是**哪个目录**，否则用户不知道去删哪个。
    assert.match(skip.where, /random-stuff/)
  })
})

// ── 报错必须带文件路径（M1.5-3）────────────────────────────────────────────

test('JSON 语法错误 → 报错带文件路径与 JSON 解析器的原话', () => {
  withTempDir((dir) => {
    write(dir, 'broken/pack.json', '{ "id": "pack.broken",, }')
    const result = loadContentPacks(dir)
    assert.deepEqual(result.packs, [])
    const err = result.issues.find((i) => i.level === 'error')
    assert.ok(err)
    assert.match(err.where, /broken\/pack\.json/, '报错必须指出是哪个文件')
    assert.match(err.message, /JSON 语法错误/)
  })
})

test('清单不是对象 → 报错并说明期望的形状', () => {
  withTempDir((dir) => {
    write(dir, 'p/pack.json', '["我不是对象"]')
    const result = loadContentPacks(dir)
    assert.match(result.issues[0].where, /p\/pack\.json/)
    assert.match(result.issues[0].message, /顶层必须是一个对象/)
  })
})

test('schemaVersion 不匹配 → 一条 error（不重复报两次），路径带文件名', () => {
  withTempDir((dir) => {
    write(dir, 'p/pack.json', manifest('pack.p', { schemaVersion: CONTENT_SCHEMA_VERSION + 1 }))
    const result = loadContentPacks(dir)
    const errs = result.issues.filter((i) => i.level === 'error')
    assert.equal(errs.length, 1, `同一个问题只该报一次，得到：${JSON.stringify(errs)}`)
    assert.match(errs[0].where, /p\/pack\.json/)
    assert.match(errs[0].message, /清单格式版本/)
  })
})

test('条目形状不对 → 报错里的 where 同时含文件路径与条目位置', () => {
  withTempDir((dir) => {
    write(dir, 'p/pack.json', manifest('pack.p', { provides: ['stations'] }))
    write(dir, 'p/stations.json', [
      { id: 'station.x', name: 'X', kind: '不存在这种站点', district: 'district.a', relativeTo: null, anchor: { x: 0, z: 0 }, capacity: 1, capabilities: ['code'], model: 'model.a' },
    ])
    const result = loadContentPacks(dir)
    const err = result.issues.find((i) => i.level === 'error' && /站点种类/.test(i.message))
    assert.ok(err, JSON.stringify(result.issues))
    assert.match(err.where, /p\/stations\.json/, '要能看到改哪个文件')
    // 定位到**条目 id** 而不是数组下标：手写 JSON 里搜 id 比数第几个元素快得多。
    assert.match(err.where, /station\.x/, '也要能定位到具体是哪一条')
    assert.match(err.where, /kind$/, '还要能指到具体字段')
    assert.match(err.message, /desk \/ meeting/, '要给出可用取值')
  })
})

test('有一个错就整包跳过，不会加载半成品', () => {
  withTempDir((dir) => {
    write(dir, 'p/pack.json', manifest('pack.p', { provides: ['stations', 'skins'] }))
    write(dir, 'p/skins.json', [{ id: 'skin.s', name: 'S', colors: { a: '#111111' } }])
    // stations 里有非法枚举 ⇒ 整包不应被采用
    write(dir, 'p/stations.json', [
      { id: 'station.x', name: 'X', kind: '骗人的种类', district: 'district.a', relativeTo: null, anchor: { x: 0, z: 0 }, capacity: 1, capabilities: ['code'], model: 'model.a' },
    ])

    const result = loadContentPacks(dir)
    assert.deepEqual(result.packs, [], '有错就不该加载')
    assert.ok(
      result.issues.some((i) => i.level === 'warning' && /已整体跳过/.test(i.message)),
      '要明确说"整包跳过"而不是悄悄丢掉一半',
    )
  })
})

test('文件名写错（单数）→ 警告并列出可用文件名', () => {
  withTempDir((dir) => {
    write(dir, 'p/pack.json', manifest('pack.p', { provides: ['stations'] }))
    write(dir, 'p/station.json', []) // ← 单数，典型手滑
    const result = loadContentPacks(dir)
    const warn = result.issues.find((i) => i.level === 'warning' && /不认识的库文件/.test(i.message))
    assert.ok(warn, JSON.stringify(result.issues))
    assert.match(warn.where, /p\/station\.json/)
    assert.match(warn.message, /stations\.json/, '要告诉用户正确的名字')
    assert.deepEqual(result.packs.map((p) => p.manifest.id), ['pack.p'], '文件写错不该让整包失败')
  })
})

test('空数组文件 → 警告（提示"不提供就删掉这个文件"）', () => {
  withTempDir((dir) => {
    write(dir, 'p/pack.json', manifest('pack.p'))
    write(dir, 'p/sounds.json', [])
    const result = loadContentPacks(dir)
    assert.ok(result.issues.some((i) => i.level === 'warning' && /空数组/.test(i.message)))
    assert.deepEqual(result.packs.map((p) => p.manifest.id), ['pack.p'])
  })
})

test('单数 scene.json 与单对象写法都能读（少写一层方括号）', () => {
  withTempDir((dir) => {
    write(dir, 'p/pack.json', manifest('pack.p', { provides: ['scenes'] }))
    write(dir, 'p/scene.json', {
      id: 'scene.only',
      name: '只有一个场景',
      districts: [],
      stations: [],
      spawn: { x: 0, z: 0 },
      groundSize: 4,
      theme: 'theme.t',
      roster: 'roster.r',
      agentModel: 'model.a',
    })
    const result = loadContentPacks(dir)
    assert.deepEqual(result.packs.map((p) => p.manifest.id), ['pack.p'])
    assert.equal(result.packs[0].entries.scenes.length, 1)
  })
})

// ── 端到端：改内容 = 改世界（M1.5-5）──────────────────────────────────────

test('端到端：外部包顶掉花名册 → createWorld 出来的世界真的变了（不改一行代码）', () => {
  withTempDir((dir) => {
    write(
      dir,
      'my-team/pack.json',
      manifest('pack.my-team', { provides: ['rosters'], overrides: ['rosters/roster.software-team'] }),
    )
    write(dir, 'my-team/rosters.json', [
      {
        id: 'roster.software-team',
        name: '我的两人小队',
        seats: [
          { role: 'lead', name: '队长本人', palette: 'skin.role.lead', model: null, persona: '队长本人 是谁，测试 fixture 用的一句话。', speechStyle: '队长本人 的说话方式，测试 fixture 用的一句话。' },
          { role: 'engineer', name: '唯一的工程师', palette: 'skin.role.engineer', model: null, persona: '唯一的工程师 是谁，测试 fixture 用的一句话。', speechStyle: '唯一的工程师 的说话方式，测试 fixture 用的一句话。' },
        ],
      },
    ])

    const loaded = loadContentPacks(dir)
    assert.deepEqual(loaded.issues, [], '这个包应当零问题')
    assert.equal(loaded.packs.length, 1)

    const content = new ContentRegistry()
    const issues = content.loadAll([...builtinPacks(), ...loaded.packs])
    assert.deepEqual(issues, [], '显式声明的覆盖不该报任何问题')

    // 跨包校验也要干净（这里顺便证明外部包能引用内置包的地块）。
    assert.deepEqual(content.validate(), [])

    const world = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
    assert.equal(world.agents.length, 2, '花名册被换掉了，世界里就该只有 2 个人')
    assert.equal(world.agents[0].name, '队长本人')
    assert.equal(world.agents[0].role, 'lead')
    assert.equal(world.agents[1].name, '唯一的工程师')
    // 世界记录了自己是由哪些内容装出来的——否则"这局是用哪个版本的内容玩的"没法回查。
    assert.deepEqual(world.origin.packs, ['pack.default', 'pack.kenney-mini', 'pack.kenney-furniture', 'pack.my-team'])
    // 站点没被碰过：改一个库不影响别的库。
    assert.equal(world.stations.length, 10)
  })
})

test('端到端：外部包没声明 overrides 就想顶掉 → 报错，且世界用回内置内容', () => {
  withTempDir((dir) => {
    write(dir, 'sneaky/pack.json', manifest('pack.sneaky', { provides: ['rosters'] })) // 没写 overrides
    write(dir, 'sneaky/rosters.json', [
      { id: 'roster.software-team', name: '偷偷换掉', seats: [{ role: 'lead', name: 'X', palette: 'skin.role.lead', model: null, persona: 'X 是谁，测试 fixture 用的一句话。', speechStyle: 'X 的说话方式，测试 fixture 用的一句话。' }] },
    ])

    const loaded = loadContentPacks(dir)
    assert.equal(loaded.packs.length, 1, '解析阶段没问题（它本身是合法的）')

    const content = new ContentRegistry()
    const issues = content.loadAll([...builtinPacks(), ...loaded.packs])
    const err = issues.find((i) => i.level === 'error' && /overrides/.test(i.message))
    assert.ok(err, `装载阶段应当报冲突，得到 ${JSON.stringify(issues)}`)

    // 关键：内置内容**没有被换掉**。
    const world = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
    assert.equal(world.agents.length, 8, '原条目必须保持不变')
    assert.equal(world.agents[0].name, '工头阿金')
  })
})

test('端到端：外部包用 allowImplicitOverride 才允许隐式覆盖（配置可开，默认关）', () => {
  withTempDir((dir) => {
    write(dir, 'lazy/pack.json', manifest('pack.lazy', { provides: ['skins'] }))
    write(dir, 'lazy/skins.json', [{ id: 'skin.default', name: '我的配色', colors: { paper: '#000000' } }])

    const loaded = loadContentPacks(dir)
    const strict = new ContentRegistry()
    assert.ok(
      strict.loadAll([...builtinPacks(), ...loaded.packs]).some((i) => i.level === 'error'),
      '默认必须报冲突',
    )

    const lax = new ContentRegistry()
    const issues = lax.loadAll([...builtinPacks(), ...loaded.packs], { allowImplicitOverride: true })
    assert.deepEqual(issues.map((i) => i.level), ['warning'])
    assert.equal(lax.get('skins', 'skin.default').pack, 'pack.lazy')
  })
})

// ── 端到端：走完整的插件入口（M1.5-2）────────────────────────────────────

test('端到端：apply 接上 contentDir → 工具看到的世界就是外部内容装出来的', async () => {
  await withTempDirAsync(async (dir) => {
    write(
      dir,
      'my-team/pack.json',
      manifest('pack.my-team', { provides: ['rosters'], overrides: ['rosters/roster.software-team'] }),
    )
    write(dir, 'my-team/rosters.json', [
      {
        id: 'roster.software-team',
        name: '我的两人小队',
        seats: [
          { role: 'lead', name: '队长本人', palette: 'skin.role.lead', model: null, persona: '队长本人 是谁，测试 fixture 用的一句话。', speechStyle: '队长本人 的说话方式，测试 fixture 用的一句话。' },
          { role: 'engineer', name: '唯一的工程师', palette: 'skin.role.engineer', model: null, persona: '唯一的工程师 是谁，测试 fixture 用的一句话。', speechStyle: '唯一的工程师 的说话方式，测试 fixture 用的一句话。' },
        ],
      },
    ])

    const registered = []
    const logs = { info: [], warn: [], error: [] }
    const ctx = {
      tools: { register: (tool) => registered.push(tool) },
      logger: () => ({
        info: (m) => logs.info.push(m),
        warn: (m) => logs.warn.push(m),
        error: (m) => logs.error.push(m),
      }),
      effect: (fn) => {
        const dispose = fn()
        if (typeof dispose === 'function') collectedDisposers.push(dispose)
      },
      // 真实 cordis 一定有 `inject`；没有 webServer 时它的回调永不执行（软依赖语义）。
      inject: () => {},
    }

    // 绝对路径：相对路径会按 process.cwd() 解析，测试里不依赖那个。
    apply(ctx, { contentDir: dir, persistEveryTicks: 0 })

    assert.deepEqual(logs.error, [], `不该有错误：${logs.error.join(' | ')}`)
    // 解析出的目录要打出来，否则用户配了 contentDir 没生效时无从下手。
    assert.ok(
      logs.info.some((m) => m.includes(dir)),
      `日志应当报出实际读取的外部内容目录：${logs.info.join(' | ')}`,
    )

    const status = registered.find((t) => t.name === 'agent_world_status')
    const text = await status.execute({})
    assert.match(text, /角色：共 2 人/, `世界应当用外部花名册，实际输出：\n${text}`)
    assert.match(text, /队长本人/)
    assert.match(text, /工单：共 0 张/, '站点没被碰过，工单板仍是空的')
  })
})

test('端到端：contentDir 指向不存在的目录 → 只警告，插件照常可用（世界用内置内容）', async () => {
  await withTempDirAsync(async (dir) => {
    const registered = []
    const logs = { info: [], warn: [], error: [] }
    const ctx = {
      tools: { register: (tool) => registered.push(tool) },
      logger: () => ({
        info: (m) => logs.info.push(m),
        warn: (m) => logs.warn.push(m),
        error: (m) => logs.error.push(m),
      }),
      effect: (fn) => {
        const dispose = fn()
        if (typeof dispose === 'function') collectedDisposers.push(dispose)
      },
      // 真实 cordis 一定有 `inject`；没有 webServer 时它的回调永不执行（软依赖语义）。
      inject: () => {},
    }

    apply(ctx, { contentDir: join(dir, '没这个目录'), persistEveryTicks: 0 })

    assert.deepEqual(logs.error, [], '目录不存在是警告级，不该当成错误')
    assert.ok(logs.warn.some((m) => /内容目录不存在/.test(m)), `应当有警告：${logs.warn.join(' | ')}`)

    const status = registered.find((t) => t.name === 'agent_world_status')
    const text = await status.execute({})
    assert.match(text, /角色：共 8 人/, '退回内置内容，世界照常建得出来')
  })
})
