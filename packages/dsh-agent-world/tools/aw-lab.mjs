#!/usr/bin/env node
/**
 * R407：Agent World 场景实验室。
 *
 * 目标：不用开浏览器、不靠肉眼看，就能回答“派 6 个人跑 2000 tick，谁卡住、谁没到站、谁在抖”。
 *
 * 用法：
 *   node tools/aw-lab.mjs sim --ticks 1200 --agents 4
 *   node tools/aw-lab.mjs sim --game-mode --task-set task.quick-fix --json
 *   node tools/aw-lab.mjs live snapshot --url http://127.0.0.1:3082 --token ... --session ...
 *   node tools/aw-lab.mjs live command --url ... --command '{"kind":"dispatch","taskSet":"task.quick-fix"}'
 *
 * 设计约束：只依赖 lib/ 的纯模拟，不启动 webServer，不写盘；同一参数两次输出必须一致。
 */
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { out._.push(arg); continue }
    const key = arg.slice(2)
    if (key === 'json' || key === 'game-mode' || key === 'help') { out[key] = true; continue }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue }
    out[key] = next
    i += 1
  }
  return out
}

function num(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function buildContent() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return content
}

function makeWorld(content, { taskSet, agents, gameMode, seed }) {
  const world = createWorld({
    content,
    scene: 'scene.default-town',
    name: `lab-${seed}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: taskSet === null ? [] : [taskSet],
  })
  world.gameMode = gameMode === true
  const template = world.agents[0]
  if (world.agents.length > agents) world.agents.splice(agents)
  for (let i = world.agents.length; i < Math.max(1, agents); i += 1) {
    if (template === undefined) break
    world.agents.push({
      ...template,
      id: `agent-${i + 1}`,
      name: `Agent-${i + 1}`,
      role: ['engineer', 'researcher', 'reviewer', 'ops'][i % 4],
      state: 'idle',
      station: null,
      targetStation: null,
      carrying: null,
      path: [],
      boundAgentId: null,
    })
  }
  return world
}

function stationKind(world, id) {
  return world.stations.find((station) => station.id === id)?.kind ?? null
}

function audit(world, trace) {
  const issues = []
  const counts = { working: 0, walking: 0, idle: 0, talking: 0, sleeping: 0 }
  const statsById = new Map(trace.positions.map((item) => [item.id, item]))
  for (const agent of world.agents) {
    if (counts[agent.state] !== undefined) counts[agent.state] += 1
    // 待命踱步可以是直走（不挂 path）；只有“walking 但长时间完全不动”才是卡死。
    const stats = statsById.get(agent.id)
    if (agent.state === 'walking' && stats !== undefined && stats.stationaryTicks > 20) {
      issues.push(`${agent.id}: walking 但连续 ${stats.stationaryTicks} tick 未移动`)
    }
    if (agent.state === 'working') {
      const task = world.tasks.find((item) => item.id === agent.carrying)
      if (task === undefined) issues.push(`${agent.id}: working 但 carrying 没有对应任务`)
      if (agent.station === null) issues.push(`${agent.id}: working 但没有 station`)
    }
    if (agent.state === 'idle' && agent.carrying !== null) {
      issues.push(`${agent.id}: idle 但还背着任务 ${agent.carrying}`)
    }
  }
  for (const task of world.tasks) {
    if (task.status === 'in_progress' && task.owner === null) issues.push(`${task.id}: in_progress 没有 owner`)
    if (task.status === 'done' && task.progress < 1) issues.push(`${task.id}: done 但 progress<1`)
  }
  const duplicateSeats = new Map()
  for (const agent of world.agents) {
    if (agent.station === null) continue
    const key = `${agent.station}`
    duplicateSeats.set(key, [...(duplicateSeats.get(key) ?? []), agent.id])
  }
  for (const [station, ids] of duplicateSeats) {
    const capacity = world.stations.find((item) => item.id === station)?.capacity ?? 1
    if (ids.length > capacity) issues.push(`${station}: ${ids.length} 人超过容量 ${capacity}`)
  }
  const moving = trace.positions.filter((item) => item.movedTicks > 0)
  return {
    issues,
    counts,
    tasks: {
      total: world.tasks.length,
      ready: world.tasks.filter((task) => task.status === 'ready').length,
      inProgress: world.tasks.filter((task) => task.status === 'in_progress').length,
      done: world.tasks.filter((task) => task.status === 'done').length,
      failed: world.tasks.filter((task) => task.status === 'failed').length,
    },
    stations: world.stations.map((station) => ({
      id: station.id,
      kind: station.kind,
      occupied: world.agents.filter((agent) => agent.station === station.id).length,
      capacity: station.capacity,
    })),
    movement: {
      movingAgents: moving.length,
      averageMovingTicks: moving.length === 0 ? 0 : moving.reduce((sum, item) => sum + item.movedTicks, 0) / moving.length,
      maxStationaryTicks: trace.positions.reduce((max, item) => Math.max(max, item.stationaryTicks), 0),
    },
    seatKinds: world.agents
      .filter((agent) => agent.state === 'working' && agent.station !== null)
      .map((agent) => ({ agentId: agent.id, station: agent.station, kind: stationKind(world, agent.station) })),
  }
}

function simulate(options) {
  const content = buildContent()
  const world = makeWorld(content, options)
  const behaviors = content.idleBehaviors?.() ?? []
  const trace = { positions: [] }
  const perAgent = new Map()
  for (let tick = 0; tick < options.ticks; tick += 1) {
    step(world, [], { idleBehaviors: behaviors })
    for (const agent of world.agents) {
      const prev = perAgent.get(agent.id) ?? { x: agent.position.x, z: agent.position.z, movedTicks: 0, stationaryTicks: 0 }
      const moved = Math.abs(agent.position.x - prev.x) > 1e-6 || Math.abs(agent.position.z - prev.z) > 1e-6
      prev.movedTicks += moved ? 1 : 0
      prev.stationaryTicks = moved ? 0 : prev.stationaryTicks + 1
      prev.x = agent.position.x
      prev.z = agent.position.z
      perAgent.set(agent.id, prev)
    }
  }
  trace.positions = [...perAgent.entries()].map(([id, value]) => ({ id, ...value }))
  return { world, audit: audit(world, trace), trace }
}

function summarize(result) {
  const { audit } = result
  const lines = [
    `tasks ${audit.tasks.done}/${audit.tasks.total} done · in_progress ${audit.tasks.inProgress} · ready ${audit.tasks.ready} · failed ${audit.tasks.failed}`,
    `agents working ${audit.counts.working} / walking ${audit.counts.walking} / idle ${audit.counts.idle} / sleeping ${audit.counts.sleeping}`,
    `stations ${audit.stations.filter((station) => station.occupied > 0).map((station) => `${station.id}=${station.occupied}/${station.capacity}`).join(' ') || '全部空闲'}`,
    `movement movingAgents=${audit.movement.movingAgents} avgMovingTicks=${audit.movement.averageMovingTicks.toFixed(1)} maxStationary=${audit.movement.maxStationaryTicks}`,
    audit.issues.length === 0 ? 'audit OK' : `audit ${audit.issues.length} issues:\n  - ${audit.issues.join('\n  - ')}`,
  ]
  return lines.join('\n')
}

async function live(options) {
  const base = String(options.url ?? 'http://127.0.0.1:3082').replace(/\/$/, '')
  const token = options.token ?? ''
  if (token === '') throw new Error('live 需要 --token（从 dsh web 启动日志复制）')
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  const session = options.session ?? ''
  const action = options._[1] ?? 'snapshot'
  if (action === 'snapshot') {
    const response = await fetch(`${base}/agent-world/api/world`, { headers })
    const body = await response.json()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`)
    const world = body.world
    return {
      tick: world.tick,
      agents: world.agents.map((agent) => ({ id: agent.id, name: agent.name, state: agent.state, station: agent.station, carrying: agent.carrying })),
      tasks: world.tasks.map((task) => ({ id: task.id, status: task.status, owner: task.owner, station: task.station })),
      stations: world.stations.map((station) => ({ id: station.id, kind: station.kind, capacity: station.capacity })),
      session: session === '' ? null : session,
    }
  }
  if (action === 'command') {
    const raw = options.command
    const command = typeof raw === 'string' ? JSON.parse(raw) : raw
    const response = await fetch(`${base}/agent-world/api/command`, { method: 'POST', headers, body: JSON.stringify({ command }) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  throw new Error(`未知 live 子命令：${action}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help === true || args._.length === 0) {
    console.log('用法: node tools/aw-lab.mjs sim [--ticks 1200] [--agents 4] [--task-set task.quick-fix] [--game-mode] [--seed 1] [--json]')
    console.log('      node tools/aw-lab.mjs live snapshot --url http://127.0.0.1:3082 --token <token> [--session <id>]')
    console.log('      node tools/aw-lab.mjs live command --url ... --token ... --command \'{"kind":"dispatch","taskSet":"task.quick-fix"}\'')
    process.exitCode = args.help === true ? 0 : 1
    return
  }
  const mode = args._[0]
  if (mode === 'sim') {
    const options = {
      ticks: Math.max(1, Math.floor(num(args.ticks, 1200))),
      agents: Math.max(1, Math.floor(num(args.agents, 4))),
      taskSet: typeof args['task-set'] === 'string' ? args['task-set'] : 'task.quick-fix',
      gameMode: args['game-mode'] === true,
      seed: Math.max(1, Math.floor(num(args.seed, 1))),
    }
    const result = simulate(options)
    if (args.json === true) console.log(JSON.stringify({ options, audit: result.audit, trace: result.trace }, null, 2))
    else {
      console.log(summarize(result))
      if (result.audit.issues.length > 0) process.exitCode = 1
    }
    return
  }
  if (mode === 'live') {
    const result = await live(args)
    console.log(JSON.stringify(result, null, 2))
    return
  }
  throw new Error(`未知子命令：${mode}`)
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
