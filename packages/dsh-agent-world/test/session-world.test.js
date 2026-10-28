/**
 * R166：一个会话一个世界 + 只投影真实 subagent。
 *
 * 这里测的是**状态层**（不启动 HTTP/ticker）：
 * - 会话 A/B 的世界分开存、分开载；
 * - 新世界只有队长、任务板为空；
 * - syncSubagents() 只从 `agent-teams:…:<名字>` label 生成角色；
 * - 切会话/卸载后当前世界为空（不会把两个会话混在一个 world 上）。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'

const tempDirs = []
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

async function tempState() {
  const dir = await mkdtemp(join(tmpdir(), 'aw-session-'))
  tempDirs.push(dir)
  const state = createPluginState(
    resolveConfig({ autoStart: false, scene: 'scene.default-town' }),
    { storeDir: dir, initialAgents: 'captain' },
  )
  return { dir, state }
}

test('R166：新会话世界只有队长、任务为空', async () => {
  const { state } = await tempState()
  const world = state.activateSession('session-a')
  assert.equal(world.agents.length, 1)
  assert.equal(world.agents[0].name, 'captain')
  assert.equal(world.agents[0].boundAgentId, null)
  assert.equal(world.tasks.length, 0)
  assert.equal(world.tick, 0)
  state.deactivate()
})

test('R166：会话 A/B 的世界与 tick 分开保存/恢复', async () => {
  const { state } = await tempState()
  const a = state.activateSession('session-a')
  a.tick = 7
  state.deactivate()

  const b = state.activateSession('session-b')
  assert.equal(b.tick, 0, 'B 不能接在 A 的 tick 上')
  b.tick = 3
  state.deactivate()

  const a2 = state.activateSession('session-a')
  assert.equal(a2.tick, 7, 'A 应接回自己的存档')
  state.deactivate()
})

test('R166/R436：所有 subagent 子会话都投影成角色（不再只认 agent-teams 前缀）', async () => {
  const { state } = await tempState()
  const world = state.activateSession('session-a')
  const changed = state.syncSubagents('session-a', [
    { id: 'child-1', label: 'agent-teams:team:小蓝' },
    { id: 'child-2', label: 'agent-teams:team:小铁' },
    { id: 'child-3', label: '无关的其它子会话' },
    { id: 'child-1', label: 'agent-teams:team:小蓝' },
  ])
  assert.equal(changed, true)
  assert.deepEqual(world.agents.map((a) => a.name), [world.agents[0].name, '小蓝', '小铁', '无关的其它子会话'])
  assert.equal(world.agents[1].boundAgentId, 'child-1')
  assert.equal(world.agents[3].boundAgentId, 'child-3')
  assert.equal(world.events.at(-1)?.type, 'world.reset')

  state.syncSubagents('session-a', [{ id: 'child-1', label: 'agent-teams:team:小蓝' }])
  assert.equal(world.agents.length, 2, '子会话消失后角色要退场')
  state.deactivate()
})

/**
 * R165：**存档里的队长名即使陈旧，载入后也必须等于代码里的规范名**。
 *
 * ## 为什么单独钉这一条
 * 昨天试把队长的显示名从 `captain` 改成 `leader`：`tsc` 绿、全量单测 **733/733 全过**，
 * 但**真机直接不能用**——报 `member name "captain" is reserved for the captain`。
 *
 * 根因不是"改名本身错"，而是**单测与真机用的不是同一个世界**：
 * 单测用**现造**的世界（名字跟着代码走），真机用**从 `world.json` 读出来的**世界
 * （名字是持久化的）。**代码里的改名有没有作用到"读档"这条路，从来没人测过。**
 *
 * 这与 R159 的 profile 硬链是同一类：**判据瞄准的对象，和故障发生的地方不是同一个**。
 * 所以这里刻意构造"陈旧存档"：先把队长名改成旧值、落盘、再载入，然后断言它被规范化。
 */
test('R165：陈旧存档里的队长名，载入后必须被规范化（改名要作用在读档路径上）', async () => {
  const { state } = await tempState()
  const world = state.activateSession('session-a')
  const canonical = world.agents[0].name
  assert.ok(typeof canonical === 'string' && canonical !== '', '队长必须有名字')

  // 造"旧存档"：把名字写成历史值（改名前的样子），然后落盘。
  const stale = canonical === '工头阿金' ? 'captain' : '工头阿金'
  world.agents[0].name = stale
  state.deactivate()

  const reloaded = state.activateSession('session-a')
  assert.equal(
    reloaded.agents[0].name,
    canonical,
    `载入存档后队长名必须被规范化成 \`${canonical}\`，实际是 \`${reloaded.agents[0].name}\`——` +
      '说明"改名"只作用在新建世界上，没作用在读档路径上（这正是 R165 真机崩掉的原因）',
  )
  state.deactivate()
})
