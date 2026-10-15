/**
 * agent-teams → 小镇的同步策略（D41，R39）。
 *
 * 这是两套任务模型合流的**大脑**：它决定"要让小镇追上团队，该发哪些命令"。
 * 它是纯函数，所以能在这里被穷举——真机只负责证明"读得到、发得进"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planTeamSync } from '../lib/sim/index.js'

/** 小镇的一张单。默认接在团队任务 `t1` 上。 */
function worldTask(over = {}) {
  return { id: 'task-1', externalId: 't1', status: 'pending', owner: null, attemptId: null, ...over }
}

/** 团队的一张单。 */
function teamTask(over = {}) {
  return { id: 't1', subject: '改代码', status: 'pending', dependencies: [], ...over }
}

const member = (name) => (name === '小蓝' ? 'agent-2' : null)

test('D41：团队说完成了 → 发 taskComplete，带上产出', () => {
  const commands = planTeamSync({
    tasks: [teamTask({ status: 'completed', assignee: '小蓝', output: '改完了', attemptId: 'a1' })],
    worldTasks: [worldTask({ status: 'in_progress', owner: 'agent-2', attemptId: 'a1' })],
    agentIdForMember: member,
  })
  assert.deepEqual(commands, [{ kind: 'taskComplete', taskId: 'task-1', attemptId: 'a1', output: '改完了' }])
})

test('D41：团队说失败/取消 → 发 taskFail，原因要能下手', () => {
  const failed = planTeamSync({
    tasks: [teamTask({ status: 'failed', output: '依赖的接口还没定', attemptId: 'a1' })],
    worldTasks: [worldTask({ status: 'in_progress', attemptId: 'a1' })],
    agentIdForMember: member,
  })
  assert.equal(failed[0].kind, 'taskFail')
  assert.match(failed[0].reason, /依赖的接口还没定/, '成员的产出要出现在原因里')

  const cancelled = planTeamSync({
    tasks: [teamTask({ status: 'cancelled' })],
    worldTasks: [worldTask()],
    agentIdForMember: member,
  })
  assert.equal(cancelled[0].kind, 'taskFail')
  assert.match(cancelled[0].reason, /取消/)
})

test('D41：团队派给了某人而小镇还不知道 → 发 taskAssign', () => {
  const commands = planTeamSync({
    tasks: [teamTask({ status: 'in_progress', assignee: '小蓝', attemptId: 'a7' })],
    worldTasks: [worldTask()],
    agentIdForMember: member,
  })
  assert.deepEqual(commands, [{ kind: 'taskAssign', taskId: 'task-1', agentId: 'agent-2', attemptId: 'a7' }])
})

test('D41：**幂等**——同步是轮询的，同一件事会被看到很多次，不许重复发命令', () => {
  const tasks = [teamTask({ status: 'completed', assignee: '小蓝', output: 'x', attemptId: 'a1' })]
  // 小镇已经认为它完成了：不该再发。
  assert.deepEqual(planTeamSync({ tasks, worldTasks: [worldTask({ status: 'done', owner: 'agent-2' })], agentIdForMember: member }), [])
  // 已经派给同一个人了：不该再发指派。
  const assigned = [teamTask({ status: 'in_progress', assignee: '小蓝', attemptId: 'a1' })]
  assert.deepEqual(
    planTeamSync({ tasks: assigned, worldTasks: [worldTask({ status: 'in_progress', owner: 'agent-2' })], agentIdForMember: member }),
    [],
  )
})

test('D41：成员在小镇里不存在（名字对不上）→ 不指派，也不崩', () => {
  const commands = planTeamSync({
    tasks: [teamTask({ status: 'in_progress', assignee: '查无此人' })],
    worldTasks: [worldTask()],
    agentIdForMember: member,
  })
  assert.deepEqual(commands, [], '名字对不上就不指派；硬指派会让工单指向一个不存在的角色')
})

test('D41：没接团队的单、以及团队里没有的单，都不碰', () => {
  const commands = planTeamSync({
    tasks: [teamTask({ status: 'completed' })],
    worldTasks: [
      worldTask({ id: 'task-9', externalId: null }),        // 没接团队
      worldTask({ id: 'task-8', externalId: 't-missing' }), // 团队里没有
    ],
    agentIdForMember: member,
  })
  assert.deepEqual(commands, [])
})

test('D41：命令顺序按小镇任务的顺序，不随团队返回顺序变化（日志可比对）', () => {
  const tasks = [
    teamTask({ id: 't2', status: 'completed', output: 'B' }),
    teamTask({ id: 't1', status: 'completed', output: 'A' }),
  ]
  const worldTasks = [
    worldTask({ id: 'task-1', externalId: 't1', status: 'in_progress' }),
    worldTask({ id: 'task-2', externalId: 't2', status: 'in_progress' }),
  ]
  const a = planTeamSync({ tasks, worldTasks, agentIdForMember: member })
  const b = planTeamSync({ tasks: [...tasks].reverse(), worldTasks, agentIdForMember: member })
  assert.deepEqual(a.map((c) => c.taskId), ['task-1', 'task-2'])
  assert.deepEqual(a, b, '输入顺序不该影响输出')
})
