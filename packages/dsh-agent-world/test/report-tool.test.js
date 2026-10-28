import assert from 'node:assert/strict'
import test from 'node:test'
import { registerReportTool } from '../lib/tools/report.js'

const make = () => {
  const tools = []
  registerReportTool({ tools: { register: (tool) => tools.push(tool) } }, {
    report: (agent, input) => ({
      accepted: true,
      agentId: 'agent-2',
      agentName: '阿金',
      taskId: input.taskId,
      status: input.status,
      xpAwarded: input.status === 'done' ? 40 : 0,
      level: 2,
    }),
  })
  return tools[0]
}

test('agent_world_report：身份来自 exec.agent，不靠模型自报', async () => {
  const tool = make()
  const text = await tool.execute(
    { taskId: 'task-7', status: 'done', summary: '修好了', evidence: ['file:a.ts'] },
    { agent: { id: 'child-1' } },
  )
  assert.match(text, /阿金/)
  assert.match(text, /\+40 XP/)
})

test('agent_world_report：没有 agent 身份、非法 status 都拒绝', async () => {
  const tool = make()
  await assert.rejects(() => tool.execute({ taskId: 't', status: 'done', summary: 'x' }, {}), /没有 agent id/)
  await assert.rejects(
    () => tool.execute({ taskId: 't', status: 'nope', summary: 'x' }, { agent: { id: 'child-1' } }),
    /working\/done\/blocked/,
  )
})
