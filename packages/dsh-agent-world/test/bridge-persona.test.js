/**
 * 人设 → system prompt（BACKLOG M6-2）的测试。
 *
 * ## 验收判据（verifier 定的，不是我编的）
 *
 * > **改花名册 → system prompt 跟着变，代码零改动。**
 *
 * 所以要证明的不是"函数被调用了"，而是两件更强的事：
 * 1. 内容里的 `persona` / `speechStyle` 文本**确实出现在** prompt 里；
 * 2. **换掉座位的人设 → prompt 随之改变**（它真的在读内容）。
 *
 * 本文件用**真实内置内容 + 真实世界**做这两件事，而不是只用假座位——
 * 只用假座位的话，"内容真的被读到了"仍然是没验的。
 *
 * ## 这里钉住的第二个东西：`role` 陷阱
 *
 * 默认花名册里有多个同 `role` 的座位。按 `role` 反查座位会让他们**共用一份人设**，
 * 而它**不会报错**——症状只是"这几个角色说话一模一样"。
 * 所以下面有一条用例**专门**证明：同 role 的那一组，人设各不相同；
 * 并且用"按 role 找会怎样"做反证，把这个 bug 的样子写进测试里。
 *
 * ## 不碰时间
 *
 * 全部是纯函数调用，没有 sleep、没有轮询、没有 `Date.now()`——
 * 所以不存在"负载下假红"的机会（这也是 lead 提醒过的那条）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCharacterSystemPrompt, ordinalFromAgentId, seatForAgent } from '../lib/bridge/index.js'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'

// ── 夹具 ─────────────────────────────────────────────────────────────────────

/** 一个假座位。默认值都是**哨兵文本**，用来断言"它出现在 prompt 里"。 */
function seat(overrides = {}) {
  return { name: 'SENTINEL-NAME', role: 'SENTINEL-ROLE', persona: 'SENTINEL-PERSONA', speechStyle: 'SENTINEL-STYLE', ...overrides }
}

/** 一组假的世界事实（哨兵值）。 */
function facts(overrides = {}) {
  return {
    worldName: 'SENTINEL-WORLD',
    tick: 4242,
    state: 'idle',
    stationName: null,
    taskTitle: null,
    walkingTo: null,
    ...overrides,
  }
}

/** 载入真实内置内容，并断言它自己是干净的。 */
function loadContent() {
  const content = new ContentRegistry()
  const issues = content.loadAll(builtinPacks())
  const errors = issues.filter((issue) => issue.level === 'error')
  assert.equal(errors.length, 0, `内置内容不该有 error：${errors.map((e) => e.message).join(' | ')}`)
  return content
}

/** 用真实内容建一个真实世界，并把它的花名册取出来。 */
function realWorld() {
  const content = loadContent()
  const world = createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  const scene = content.require('scenes', world.origin.scene)
  const roster = content.require('rosters', scene.roster)
  return { content, world, roster }
}

/** 世界的角色 → 它的事实（测试里不做站点名解析，用 null）。 */
function factsFor(world, agent) {
  return facts({ worldName: world.name, tick: world.tick, state: agent.state })
}

/** 把世界里的每个角色都解析到座位；解析不出来就直接失败（那本身就是缺陷）。 */
function seatOfEveryAgent(world, roster) {
  return world.agents.map((agent) => {
    const resolved = seatForAgent(roster.seats, agent)
    assert.ok(resolved, `${agent.id}（${agent.name}）应当能对上花名册里的座位`)
    return { agent, seat: resolved }
  })
}

// ── 1. 内容确实进了 prompt（判据 1） ─────────────────────────────────────────

test('内容进了 prompt：persona 与 speechStyle 的原文都在（不是"函数被调用了"）', () => {
  const one = seat({ persona: '他怕把事情说死，凡事都要留一句退路。', speechStyle: '句子很短，从不用感叹号。' })

  const prompt = buildCharacterSystemPrompt(one, facts())

  assert.ok(prompt.includes('他怕把事情说死，凡事都要留一句退路。'), '人设原文必须出现在 prompt 里')
  assert.ok(prompt.includes('句子很短，从不用感叹号。'), '说话方式原文必须出现在 prompt 里')
  // 姓名与岗位也是内容（座位字段），同样要进 prompt。
  assert.ok(prompt.includes('SENTINEL-NAME'))
  assert.ok(prompt.includes('SENTINEL-ROLE'))
})

test('世界事实进了 prompt：世界名 / 时钟 / 状态 / 站点 / 工单都是事实', () => {
  const prompt = buildCharacterSystemPrompt(
    seat(),
    facts({ state: 'working', stationName: 'SENTINEL-STATION', taskTitle: 'SENTINEL-TASK', tick: 4242 }),
  )

  assert.ok(prompt.includes('SENTINEL-WORLD'), '世界名是事实，要带进上下文')
  assert.ok(prompt.includes('4242'), '世界时钟是事实（第几个 tick）')
  assert.ok(prompt.includes('SENTINEL-STATION'))
  assert.ok(prompt.includes('SENTINEL-TASK'))
  assert.match(prompt, /干活/, 'state=working 要变成人能读懂的事实描述')
})

test('在路上时说明目的地；空手时说明没工单（两个分支都要有话说）', () => {
  const walking = buildCharacterSystemPrompt(seat(), facts({ state: 'walking', walkingTo: 'SENTINEL-DEST' }))
  assert.ok(walking.includes('SENTINEL-DEST'), '在路上时要报出目的地')

  const idle = buildCharacterSystemPrompt(seat(), facts({ taskTitle: null }))
  assert.match(idle, /没有工单/, '空手要明说，而不是留一个空行让人猜')
})

test('纯函数：同一份输入给同一份输出（可复现，才谈得上"改内容看得见变化"）', () => {
  const one = seat()
  const same = facts()

  assert.equal(buildCharacterSystemPrompt(one, same), buildCharacterSystemPrompt(one, same))
})

// ── 2. 改花名册 → prompt 跟着变（判据 2） ────────────────────────────────────

test('改内容 → prompt 跟着变：换掉 persona / speechStyle，输出立刻不同（代码零改动）', () => {
  const base = seat({ persona: '原始人设', speechStyle: '原始语气' })
  const tweaked = seat({ persona: '改过的人设', speechStyle: '改过的语气' })

  const before = buildCharacterSystemPrompt(base, facts())
  const after = buildCharacterSystemPrompt(tweaked, facts())

  assert.notEqual(before, after, '★ 换掉座位的人设，prompt 必须随之改变')
  assert.ok(after.includes('改过的人设') && after.includes('改过的语气'))
  assert.ok(!after.includes('原始人设'), '旧内容不该残留')
})

test('改内容 → prompt 跟着变：**真实花名册**上做一次（证明它真的在读内容）', () => {
  const { world, roster } = realWorld()
  const agent = world.agents[1]
  assert.ok(agent, '默认世界至少有 2 个角色')

  const original = seatForAgent(roster.seats, agent)
  assert.ok(original, 'agent-2 应当能对上座位')

  const before = buildCharacterSystemPrompt(original, factsFor(world, agent))

  // 改一份**内容副本**（不改共享的 roster 对象，免得污染其它用例）。
  const ordinal = ordinalFromAgentId(agent.id)
  const patchedSeats = roster.seats.map((s, i) => (i === ordinal - 1 ? { ...s, persona: 'SENTINEL-REPLACED-PERSONA' } : s))
  const patched = seatForAgent(patchedSeats, agent)
  const after = buildCharacterSystemPrompt(patched, factsFor(world, agent))

  assert.ok(after.includes('SENTINEL-REPLACED-PERSONA'), '替换后的人设必须出现在 prompt 里')
  assert.ok(before.includes(original.persona.trim()), '替换前，prompt 里是这份内容自己的原文')
  assert.notEqual(before, after, '★ 换掉内容，prompt 必须跟着变')
})

// ── 3. 空人设要响，不要静默产出没人设的 prompt ───────────────────────────────

test('人设为空 → 抛，且原因能直接下手（空人设的症状是"所有人都像同一个人"）', () => {
  assert.throws(() => buildCharacterSystemPrompt(seat({ persona: '   ' }), facts()), /人设是空的/)
  assert.throws(() => buildCharacterSystemPrompt(seat({ speechStyle: '' }), facts()), /说话方式是空的/)
  // 报错要指出去哪修。
  assert.throws(() => buildCharacterSystemPrompt(seat({ persona: '' }), facts()), /内容库/)
})

// ── 4. 座位解析：序号优先、名字兜底、有歧义就拒绝 ────────────────────────────

test('ordinalFromAgentId：只认 agent-<n>（n≥1）', () => {
  assert.equal(ordinalFromAgentId('agent-1'), 1)
  assert.equal(ordinalFromAgentId('agent-12'), 12)
  assert.equal(ordinalFromAgentId('agent-0'), null, '序号从 1 起')
  assert.equal(ordinalFromAgentId('agent-x'), null)
  assert.equal(ordinalFromAgentId('agent-'), null)
  assert.equal(ordinalFromAgentId('subagent-1'), null, '别被前缀相似的 id 骗了')
  assert.equal(ordinalFromAgentId(''), null)
})

test('座位解析：按序号（域自己的规则 roster.seats[i] → agent-<i+1>）', () => {
  const seats = [seat({ name: 'A' }), seat({ name: 'B' }), seat({ name: 'C' })]

  assert.equal(seatForAgent(seats, { id: 'agent-2', name: 'B' })?.name, 'B')
  assert.equal(seatForAgent(seats, { id: 'agent-3', name: 'C' })?.name, 'C')
})

test('座位解析：序号对不上名字时不吃硬认，退回按名字找', () => {
  const seats = [seat({ name: 'A' }), seat({ name: 'B' })]

  // 花名册在运行期被换过：agent-1 位置上的人已经不是 A 了。
  // 这时按序号硬认会把**别人的**人设发给这个角色，所以必须退回按名字。
  assert.equal(seatForAgent(seats, { id: 'agent-1', name: 'B' })?.name, 'B')
})

test('座位解析：名字有歧义 → 返回 undefined（宁可拒绝，也不猜一个）', () => {
  const seats = [seat({ name: '同名', persona: '第一份' }), seat({ name: '同名', persona: '第二份' })]

  assert.equal(
    seatForAgent(seats, { id: 'not-an-agent-id', name: '同名' }),
    undefined,
    '两个座位同名时无法判断是哪一位；挑第一个会让两个人共用一份人设，那是最难查的一类 bug',
  )
})

test('座位解析：找不到就 undefined（由调用方报可下手的原因）', () => {
  assert.equal(seatForAgent([seat({ name: 'A' })], { id: 'agent-9', name: '不存在的人' }), undefined)
  assert.equal(seatForAgent([], { id: 'agent-1', name: 'A' }), undefined)
})

// ── 5. `role` 陷阱：同 role 不能共用一份人设（**这条最重要**） ───────────────

test('陷阱：同 role 的多个座位各有各的人设（不按 role 反查）', () => {
  const { world, roster } = realWorld()
  const resolved = seatOfEveryAgent(world, roster)

  // 先把"按 role 分组"算出来：默认花名册里确实有重复 role，否则这条测试没有意义。
  const byRole = new Map()
  for (const entry of resolved) {
    const group = byRole.get(entry.seat.role) ?? []
    group.push(entry)
    byRole.set(entry.seat.role, group)
  }
  const duplicated = [...byRole.entries()].filter(([, group]) => group.length > 1)
  assert.ok(
    duplicated.length > 0,
    '默认花名册里一定有多个同 role 的座位，否则"按 role 找座位"这个 bug 不会真的发生（那这条测试就该删掉）',
  )

  for (const [role, group] of duplicated) {
    const ids = group.map((entry) => entry.agent.id)
    const personas = group.map((entry) => entry.seat.persona)
    const prompts = group.map((entry) => buildCharacterSystemPrompt(entry.seat, factsFor(world, entry.agent)))

    assert.equal(new Set(ids).size, group.length, `${role} 这一组必须是**不同的**角色`)
    assert.equal(
      new Set(personas).size,
      group.length,
      `★★ role=${role} 有 ${group.length} 个座位，它们的人设必须各不相同——` +
        '如果这里相等，说明座位是按 role 反查的，这几个角色会说话一模一样',
    )
    assert.equal(new Set(prompts).size, group.length, `role=${role} 的 prompt 必须互不相同`)
  }
})

test('反证：如果按 role 找座位，这一组会共用同一份人设（把这个 bug 的样子钉住）', () => {
  const { world, roster } = realWorld()
  const resolved = seatOfEveryAgent(world, roster)

  const byRole = new Map()
  for (const entry of resolved) {
    const group = byRole.get(entry.seat.role) ?? []
    group.push(entry)
    byRole.set(entry.seat.role, group)
  }
  const duplicated = [...byRole.values()].find((group) => group.length > 1)
  assert.ok(duplicated !== undefined, '需要一个重复 role 才能做这个反证')

  const role = duplicated[0].seat.role
  // 故意写下错误的实现：`seats.find(s => s.role === role)`。
  const wrongSeat = roster.seats.find((s) => s.role === role)
  assert.ok(wrongSeat !== undefined)

  const wrongPersonas = duplicated.map(() => wrongSeat.persona)
  assert.equal(
    new Set(wrongPersonas).size,
    1,
    '按 role 找的结果就是"全部拿到第一份人设"——这正是我们要避免的症状',
  )
  // 而正确的实现给出的是多份。
  assert.equal(new Set(duplicated.map((entry) => entry.seat.persona)).size, duplicated.length)
})

// ── 6. 真实内容整体：每个角色一份不同的 prompt ───────────────────────────────

test('真实内容：每个角色的 prompt 互不相同，且各自包含自己那份人设', () => {
  const { world, roster } = realWorld()
  const resolved = seatOfEveryAgent(world, roster)

  assert.ok(resolved.length >= 2, `默认世界应当有多个角色，实际 ${resolved.length}`)

  const prompts = resolved.map((entry) => buildCharacterSystemPrompt(entry.seat, factsFor(world, entry.agent)))

  assert.equal(
    new Set(prompts).size,
    prompts.length,
    '★ "每个人有自己的语气"的前提：每个角色的 prompt 必须互不相同',
  )

  for (const entry of resolved) {
    const prompt = buildCharacterSystemPrompt(entry.seat, factsFor(world, entry.agent))
    assert.ok(prompt.includes(entry.seat.persona.trim()), `${entry.agent.id} 的 prompt 里要有他自己的人设`)
    assert.ok(prompt.includes(entry.seat.speechStyle.trim()), `${entry.agent.id} 的 prompt 里要有他自己的说话方式`)
    assert.ok(prompt.includes(entry.agent.name), `${entry.agent.id} 的 prompt 里要有他的名字`)
  }
})

test('真实内容：不会串味（A 的 prompt 里不出现 B 的人设/名字）', () => {
  const { world, roster } = realWorld()
  const resolved = seatOfEveryAgent(world, roster)
  if (resolved.length < 2) return

  for (const entry of resolved) {
    const prompt = buildCharacterSystemPrompt(entry.seat, factsFor(world, entry.agent))
    for (const other of resolved) {
      if (other.agent.id === entry.agent.id) continue
      assert.ok(
        !prompt.includes(other.seat.persona.trim()),
        `${entry.agent.id} 的 prompt 里不该出现 ${other.agent.id} 的人设`,
      )
      assert.ok(
        !prompt.includes(other.seat.speechStyle.trim()),
        `${entry.agent.id} 的 prompt 里不该出现 ${other.agent.id} 的说话方式`,
      )
      assert.ok(
        !prompt.includes(other.agent.name),
        `${entry.agent.id} 的 prompt 里不该出现 ${other.agent.id} 的名字`,
      )
    }
  }
})

test('真实内容：角色的 id 与花名册序号一一对应（域自己的规则没变）', () => {
  const { world, roster } = realWorld()

  const resolved = world.agents.map((agent) => {
    const ordinal = ordinalFromAgentId(agent.id)
    assert.ok(ordinal !== null, `${agent.id} 应当符合 agent-<n> 的形状`)
    const byOrdinal = roster.seats[ordinal - 1]
    assert.ok(byOrdinal !== undefined, `${agent.id} 应当能对上第 ${ordinal} 个座位`)
    assert.equal(
      byOrdinal.name,
      agent.name,
      `${agent.id} 的名字必须等于花名册第 ${ordinal} 个座位的名字——` +
        '这条关系是 `content/instantiate.ts` 定的；它一变，座位解析就要跟着改',
    )
    return { agent, seat: byOrdinal }
  })

  assert.equal(resolved.length, world.agents.length)
})
