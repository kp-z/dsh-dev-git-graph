/**
 * 内容库层测试（BACKLOG M1-1…M1-4）。
 *
 * 这一组测试是**"方便替换升级和切换"这句话的证明**：覆盖必须显式、提供方链可切换、
 * 引用完整性会在加载时红、任务依赖环会被拦住。没有这些，内容库就只是"把常量挪了个地方"。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONTENT_SCHEMA_VERSION,
  ContentRegistry,
  builtinPacks,
  defaultPack,
  validatePack,
} from '../lib/content/index.js'
import { findDependencyCycle } from '../lib/content/validate.js'

/** 造一个最小但自洽的包。默认不提供任何条目——由调用方按需覆盖。 */
function makePack(id, { requires = [], provides = [], overrides = [], entries = {}, schemaVersion = CONTENT_SCHEMA_VERSION } = {}) {
  return {
    manifest: {
      id,
      name: `测试包 ${id}`,
      version: '1.0.0',
      schemaVersion,
      description: '测试用',
      requires,
      provides,
      overrides,
    },
    entries,
  }
}

/** 已装载内置内容的注册表。 */
function loaded() {
  const content = new ContentRegistry()
  const issues = content.loadAll(builtinPacks())
  assert.deepEqual(issues, [], '内置内容应当零问题')
  return content
}

// ── 覆盖必须显式 ────────────────────────────────────────────────────────────

test('撞 id 但没声明 overrides → 报错，且原始条目保持不变', () => {
  const content = loaded()

  const rival = makePack('pack.rival', {
    provides: ['actions'],
    entries: {
      actions: [{ id: 'action.walk', name: '走路（对手版）', state: 'walking', clip: 'walk-fast', loop: true, speedScale: 2, fadeMs: 100 }],
    },
  })

  const issues = content.load(rival)
  const errors = issues.filter((i) => i.level === 'error')
  assert.equal(errors.length, 1, `应当有一个冲突错误，得到：${JSON.stringify(issues)}`)
  assert.match(errors[0].message, /overrides/, '错误信息要告诉人怎么修，即"去写 overrides"')

  // 关键：原条目**没有被换掉**。悄悄覆盖是最难查的一类问题。
  const walk = content.get('actions', 'action.walk')
  assert.equal(walk.pack, 'pack.default')
  assert.equal(walk.data.speedScale, 1)
})

test('声明了 overrides → 生效，且旧提供方留在链上做回退', () => {
  const content = loaded()

  const rival = makePack('pack.rival', {
    provides: ['actions'],
    overrides: ['actions/action.walk'],
    entries: {
      actions: [{ id: 'action.walk', name: '走路（对手版）', state: 'walking', clip: 'walk-fast', loop: true, speedScale: 2, fadeMs: 100 }],
    },
  })

  assert.deepEqual(content.load(rival), [], '显式覆盖不该报任何问题')

  const walk = content.get('actions', 'action.walk')
  assert.equal(walk.pack, 'pack.rival', '新包排到链首 = 当前生效')
  assert.equal(walk.data.clip, 'walk-fast')

  // 链上还留着原来的提供方——这是"切换"的基础，也是资产加载失败时的回退。
  assert.deepEqual(content.providersOf('actions', 'action.walk'), ['pack.rival', 'pack.default'])
})

// ── 切换提供方 ──────────────────────────────────────────────────────────────

test('resolve 按 prefer 排序，未提到的提供方跟在后面（优先 ≠ 只能用它）', () => {
  const content = loaded()
  content.load(
    makePack('pack.rival', {
      provides: ['actions'],
      overrides: ['actions/action.walk'],
      entries: {
        actions: [{ id: 'action.walk', name: '走路（对手版）', state: 'walking', clip: 'walk-fast', loop: true, speedScale: 2, fadeMs: 100 }],
      },
    }),
  )

  // 默认：装载顺序决定，新包优先。
  assert.deepEqual(content.resolve('actions', 'action.walk').map((p) => p.pack), ['pack.rival', 'pack.default'])

  // 显式切回内置包。
  const back = content.resolve('actions', 'action.walk', ['pack.default'])
  assert.deepEqual(back.map((p) => p.pack), ['pack.default', 'pack.rival'])
  assert.equal(back[0].data.clip, null, '内置包的动作是程序化的（clip=null）')

  // prefer 里写了个不相干的包：不该把条目弄丢，只是没起作用。
  const unrelated = content.resolve('actions', 'action.walk', ['pack.nope'])
  assert.equal(unrelated.length, 2, 'prefer 命中不了就退回原链，不能变空')
})

test('allowImplicitOverride 打开时只警告不报错（给"用户本地内容顶掉内置"用）', () => {
  const content = loaded()
  const rival = makePack('pack.local', {
    provides: ['skins'],
    entries: { skins: [{ id: 'skin.default', name: '本地配色', colors: { paper: '#000000' } }] },
  })

  const issues = content.load(rival, { allowImplicitOverride: true })
  assert.deepEqual(issues.map((i) => i.level), ['warning'])
  assert.equal(content.get('skins', 'skin.default').pack, 'pack.local')
})

// ── 跨包引用完整性 ──────────────────────────────────────────────────────────

test('站点引用了不存在的地块 → 校验报错，且报错里列出可用值', () => {
  const content = new ContentRegistry()
  content.load(makePack('pack.broken', {
    provides: ['stations'],
    entries: {
      stations: [
        { id: 'station.orphan', name: '孤儿工位', kind: 'desk', district: 'district.不存在', relativeTo: null, anchor: { x: 0, z: 0 }, capacity: 1, capabilities: ['code'], model: 'model.station.desk' },
      ],
    },
  }))

  const issues = content.validate()
  assert.equal(issues.filter((i) => i.level === 'error').length, 1)
  assert.match(issues[0].message, /district\.不存在/)
  assert.match(issues[0].message, /场景|可用|空的/, '报错要能让人直接下手，不能只说"引用无效"')
})

test('场景引用了不存在的站点 → 报错', () => {
  const content = loaded()
  content.load(
    makePack('pack.badscene', {
      provides: ['scenes'],
      entries: {
        scenes: [
          {
            id: 'scene.broken',
            name: '坏场景',
            districts: ['district.engineering'],
            stations: ['station.根本没这个'],
            spawn: { x: 0, z: 0 },
            groundSize: 8,
            theme: 'theme.cozy-isometric',
            roster: 'roster.software-team',
            agentModel: 'model.agent.base',
          },
        ],
      },
    }),
  )
  const issues = content.validate()
  assert.ok(issues.some((i) => i.level === 'error' && /station\.根本没这个/.test(i.message)))
})

test('皮肤 token 引用不存在 → 报错（只在装了皮肤库时查）', () => {
  const content = new ContentRegistry()
  content.load(
    makePack('pack.noskin', {
      provides: ['districts', 'skins'],
      entries: {
        skins: [{ id: 'skin.default', name: '皮', colors: { 'ground.x': '#111111' } }],
        districts: [
          { id: 'district.a', name: 'A', kind: 'commons', bounds: { min: { x: 0, z: 0 }, max: { x: 1, z: 1 } }, ground: 'skin.ground.不存在' },
        ],
      },
    }),
  )
  const issues = content.validate()
  assert.ok(
    issues.some((i) => i.level === 'error' && /skin\.ground\.不存在/.test(i.message)),
    `应报出缺失的皮肤 token，得到：${JSON.stringify(issues)}`,
  )
})

test('某个 AgentState 没有动作 → 报错（否则角色会僵在上一帧）', () => {
  const content = new ContentRegistry()
  content.load(
    makePack('pack.halfactions', {
      provides: ['actions'],
      entries: {
        actions: [
          { id: 'action.idle', name: '待命', state: 'idle', clip: null, loop: true, speedScale: 1, fadeMs: 100 },
          { id: 'action.walk', name: '走路', state: 'walking', clip: null, loop: true, speedScale: 1, fadeMs: 100 },
        ],
      },
    }),
  )
  const issues = content.validate()
  const missing = issues.filter((i) => i.level === 'error' && /没有任何动作服务于状态/.test(i.message))
  // working / talking / blocked / celebrating 四个状态缺动作。
  assert.equal(missing.length, 4, `应报 4 个缺动作的状态，得到 ${missing.length}：${JSON.stringify(issues)}`)
})

// ── 任务集：环与缺失依赖 ────────────────────────────────────────────────────

test('任务依赖成环 → 报错（有环的工单永远到不了 ready，调度器会静默卡死）', () => {
  const content = new ContentRegistry()
  const issues = content.load(
    makePack('pack.cyclic', {
      provides: ['tasks'],
      entries: {
        tasks: [
          {
            id: 'task.cycle',
            name: '环',
            description: '',
            tasks: [
              { key: 'a', title: 'A', description: '', requires: ['code'], dependsOn: ['b'], acceptance: 'ok', estimateTicks: null, role: null },
              { key: 'b', title: 'B', description: '', requires: ['code'], dependsOn: ['a'], acceptance: 'ok', estimateTicks: null, role: null },
            ],
          },
        ],
      },
    }),
  )
  const cycle = issues.find((i) => i.level === 'error' && /依赖存在环/.test(i.message))
  assert.ok(cycle, `应当报出环，得到：${JSON.stringify(issues)}`)
  assert.match(cycle.message, /a → b → a|b → a → b/)

  // 也直接测函数本身（它是纯函数，值得单独钉住）。
  assert.deepEqual(findDependencyCycle([{ key: 'x', dependsOn: [] }]), null)
  assert.deepEqual(findDependencyCycle([{ key: 'x', dependsOn: ['x'] }]), ['x', 'x'])
})

test('任务依赖指向集合外的 key → 报错，并列出集合内的可用 key', () => {
  const content = new ContentRegistry()
  const issues = content.load(
    makePack('pack.baddep', {
      provides: ['tasks'],
      entries: {
        tasks: [
          {
            id: 'task.set',
            name: '集',
            description: '',
            tasks: [
              { key: 'a', title: 'A', description: '', requires: ['code'], dependsOn: ['nope'], acceptance: 'ok', estimateTicks: null, role: null },
            ],
          },
        ],
      },
    }),
  )
  const err = issues.find((i) => i.level === 'error' && /不在同一个任务集里/.test(i.message))
  assert.ok(err, `应当报出跨集合依赖，得到：${JSON.stringify(issues)}`)
  assert.match(err.message, /可用 key：a/)
})

// ── 清单与装载 ──────────────────────────────────────────────────────────────

test('schemaVersion 不匹配 → 明确拒绝，而不是猜着加载', () => {
  const bad = makePack('pack.future', { schemaVersion: CONTENT_SCHEMA_VERSION + 1 })
  const issues = validatePack(bad)
  const err = issues.find((i) => i.level === 'error' && /清单格式版本/.test(i.message))
  assert.ok(err, `应当报出版本不支持，得到：${JSON.stringify(issues)}`)
  assert.match(err.message, new RegExp(String(CONTENT_SCHEMA_VERSION)))
})

test('依赖的包不存在 → 报错并列出已提供的包', () => {
  const content = new ContentRegistry()
  const issues = content.loadAll([makePack('pack.a', { requires: ['pack.missing'] })])
  const err = issues.find((i) => i.level === 'error' && /没有提供/.test(i.message))
  assert.ok(err, `应当报出缺失的依赖，得到：${JSON.stringify(issues)}`)
  assert.match(err.message, /pack\.a/)
})

test('包依赖成环 → 报错，不会无限递归', () => {
  const content = new ContentRegistry()
  const issues = content.loadAll([
    makePack('pack.a', { requires: ['pack.b'] }),
    makePack('pack.b', { requires: ['pack.a'] }),
  ])
  assert.ok(
    issues.some((i) => i.level === 'error' && /包依赖存在环/.test(i.message)),
    `应当报出包依赖环，得到：${JSON.stringify(issues)}`,
  )
})

test('依赖顺序：被依赖的先装，于是后装的能覆盖先装的', () => {
  const content = new ContentRegistry()
  const base = makePack('pack.base', {
    provides: ['skins'],
    entries: { skins: [{ id: 'skin.x', name: '基', colors: { a: '#111111' } }] },
  })
  const top = makePack('pack.top', {
    requires: ['pack.base'],
    provides: ['skins'],
    overrides: ['skins/skin.x'],
    entries: { skins: [{ id: 'skin.x', name: '顶', colors: { a: '#222222' } }] },
  })

  // 故意把 top 放在前面传入：拓扑序应当把它排到 base 之后。
  const issues = content.loadAll([top, base])
  assert.deepEqual(issues, [])
  assert.deepEqual(content.packIds, ['pack.base', 'pack.top'])
  assert.equal(content.get('skins', 'skin.x').pack, 'pack.top')
})

test('同一个包重复装载 → 忽略并警告，不会把链搞乱', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const issues = content.load(defaultPack)
  assert.deepEqual(issues.map((i) => i.level), ['warning'])
  assert.equal(content.providersOf('actions', 'action.walk').length, 1)
})

test('require 找不到时，报错要带上"谁在找"和可用条目', () => {
  const content = loaded()
  assert.throws(
    () => content.require('scenes', 'scene.没有', '建世界时指定的场景'),
    (err) => {
      assert.match(err.message, /scene\.没有/)
      assert.match(err.message, /建世界时指定的场景/)
      assert.match(err.message, /scene\.default-town/, '要列出可用条目，否则用户不知道有什么可选')
      return true
    },
  )
})

test('内置包的清单自洽：provides 与实到条目一一对应', () => {
  const issues = validatePack(defaultPack)
  assert.deepEqual(issues, [])
  for (const kind of defaultPack.manifest.provides) {
    assert.ok(Array.isArray(defaultPack.entries[kind]) && defaultPack.entries[kind].length > 0, `${kind} 在 provides 里但没有条目`)
  }
})

test('list 输出按 id 排序（稳定的输出顺序，否则测试与 diff 会飘）', () => {
  const content = loaded()
  const ids = content.list('stations').map((e) => e.id)
  assert.deepEqual(ids, [...ids].sort())
  // ⚠️ **不要写死条数**：R62 起内置包多了 `pack.office` 的 24 个座位，
  // 而"条数"是内容选择、不是这条测试要守的性质（顺序稳定才是）。这里只要求非空。
  assert.ok(ids.length > 0, '站点库不该是空的')
})

// ── R44：小镇自己干得了的活 ──────────────────────────────────────────────────

test('R44：内置任务集里有一套**只用现有工具就能走完**的流水线', async () => {
  const { builtinPacks } = await import('../lib/content/index.js')
  const sets = builtinPacks().flatMap((p) => p.entries.tasks ?? [])
  const town = sets.find((s) => s.id === 'task.town-inspection')
  assert.ok(town, '缺少小镇自己的巡检流水线——居民只有看世界/读内容/派单，软件工程那套走不完')
  assert.equal(town.tasks.length, 3)
  // 每一步都得有验收条件（没有的话模型无从判断自己做完没有）。
  for (const step of town.tasks) {
    assert.ok(typeof step.acceptance === 'string' && step.acceptance.trim() !== '', `${step.key} 缺验收条件`)
  }
  // 依赖是一条链：survey → check → report。
  const byKey = Object.fromEntries(town.tasks.map((t) => [t.key, t]))
  assert.deepEqual(byKey.survey.dependsOn, [])
  assert.deepEqual(byKey.check.dependsOn, ['survey'])
  assert.deepEqual(byKey.report.dependsOn, ['check'])
})

test('R44：要代码工具的那两套**明确标注**了当前走不完（避免下一个人再拿它们开局）', async () => {
  const { builtinPacks } = await import('../lib/content/index.js')
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../src/content/packs/default.ts', import.meta.url), 'utf8'),
  )
  for (const id of ['task.software-feature', 'task.quick-fix']) {
    assert.ok(source.includes(`id: '${id}'`), `${id} 不见了`)
  }
  // 两处措辞不完全一样（一处是「要**代码工具**」），所以按更宽的词数。
  assert.ok((source.match(/代码工具/g) ?? []).length >= 2, '两套软件工程流水线都要有「需要代码工具」的警示注释')
})
