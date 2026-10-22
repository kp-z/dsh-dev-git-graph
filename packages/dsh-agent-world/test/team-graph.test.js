import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTeamGraph } from '../web/core/team-graph.js'

test('TeamGraph：root + catalog 父子链 + 任务归属', () => {
  const graph = buildTeamGraph({
    rootId: 'root',
    byId: {
      root: { title: '主会话', running: true },
      a: { title: '子 A', parentId: 'root' },
      b: { title: '子 B', parentId: 'root', running: true },
    },
    catalogs: { root: { entries: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } },
    team: {
      members: [
        { id: 'root', name: 'lead', role: 'lead' },
        { id: 'a', name: 'architect', role: 'teammate' },
        { id: 'b', name: 'dev', role: 'teammate' },
      ],
      tasks: [
        { id: 'task-1', subject: '设计', ownerName: 'architect', status: 'pending' },
        { id: 'task-2', subject: '实现', ownerName: 'dev', status: 'in_progress' },
      ],
    },
  })
  assert.equal(graph.nodes.length, 3)
  assert.equal(graph.edges.length, 2)
  const a = graph.nodes.find((node) => node.id === 'a')
  assert.equal(a.label, 'architect')
  assert.equal(a.tasks[0].id, 'task-1')
  assert.equal(graph.nodes.find((node) => node.id === 'b').state, 'running')
  assert.equal(graph.nodes.find((node) => node.id === 'root').kind, 'lead')
})

test('TeamGraph：无 catalog 时用 summary.parentId 兜底，不重复/不循环', () => {
  const graph = buildTeamGraph({
    rootId: 'root',
    byId: {
      root: { title: 'root' },
      a: { parentId: 'root' },
      b: { parentId: 'a' },
    },
    catalogs: {},
  })
  assert.deepEqual(graph.nodes.map((node) => node.id), ['root', 'a', 'b'])
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, 3)
})
