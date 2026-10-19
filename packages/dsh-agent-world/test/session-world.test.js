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

test('R166：只把 agent-teams 子会话 label 投影成角色', async () => {
  const { state } = await tempState()
  const world = state.activateSession('session-a')
  const changed = state.syncSubagents('session-a', [
    { id: 'child-1', label: 'agent-teams:team:小蓝' },
    { id: 'child-2', label: 'agent-teams:team:小铁' },
    { id: 'child-3', label: '无关的其它子会话' },
  ])
  assert.equal(changed, true)
  assert.deepEqual(world.agents.map((a) => a.name), [world.agents[0].name, '小蓝', '小铁'])
  assert.equal(world.agents[1].boundAgentId, 'child-1')
  assert.equal(world.agents.some((a) => a.name === '无关的其它子会话'), false)
  assert.equal(world.events.at(-1)?.type, 'world.reset')

  state.syncSubagents('session-a', [{ id: 'child-1', label: 'agent-teams:team:小蓝' }])
  assert.equal(world.agents.length, 2, '子会话消失后角色要退场')
  state.deactivate()
})
